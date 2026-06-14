import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import { GaussianParams } from "../types/gaussian-params.ts";
import { OHLCV } from "../../../types/market-data/ohlcv.ts";
import { forwardLogAlpha } from "../forward-backward.ts";
import { logSumExp } from "../utils/math.ts";
import { computeLogReturns } from "../utils/returns.ts";
import { trainHSMM } from "./baum-welch.ts";
import { viterbiHSMM } from "./decode.ts";
import { buildExpandedA, buildExpandedEmissions, buildExpandedPi, remainingDurationOf } from "./expand.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "..", "..", "..", "..", "data");

const N = 3;
const D = 20;
const TRAIN_FRACTION = 0.8;
const MIN_OBSERVATIONS = 500;

const CSV_PATH = resolve(DATA_DIR, "hsmm-screen-results.csv");
const LOG_PATH = resolve(DATA_DIR, "hsmm-screen-progress.log");

const CSV_HEADER = "symbol,numObservations,trainSize,testSize,finalLogLikelihood,crashMean,crashVar,calmMean,calmVar,upMean,upVar,avgSegmentLengthAll,avgUpSegmentLength,maeAll,maeSegStarts,nSegStarts,relativeMae,regimeSeparation,combinedScore";
writeFileSync(CSV_PATH, CSV_HEADER + "\n");
writeFileSync(LOG_PATH, "");

function log(line: string) {
  console.log(line);
  appendFileSync(LOG_PATH, line + "\n");
}

const topStocks = (JSON.parse(readFileSync(resolve(DATA_DIR, "top-stocks.json"), "utf-8")) as { symbol: string; isTopStock?: boolean }[])
  .filter((s) => s.isTopStock)
  .map((s) => s.symbol);

const uniformPi = Array(N).fill(1 / N);

function initParams(obs: number[]) {
  const mean = obs.reduce((sum, x) => sum + x, 0) / obs.length;
  const variance = obs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / obs.length;
  const std = Math.sqrt(variance);

  const A = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 0 : 1 / (N - 1))));
  const pi = Array(N).fill(1 / N);
  const durations = Array.from({ length: N }, () => Array(D).fill(1 / D));
  const emissionParams: GaussianParams[] = [
    { mean: mean - std * 0.5, variance: variance * 2 }, // crash / high-vol
    { mean, variance: variance * 0.3 }, // calm
    { mean: mean + std * 0.5, variance }, // trending up
  ];
  return { A, pi, durations, emissionParams };
}

function segmentLengths(moods: number[]): { length: number; mood: number }[] {
  const segments: { length: number; mood: number }[] = [];
  let start = 0;
  for (let t = 1; t <= moods.length; t++) {
    if (t === moods.length || moods[t] !== moods[start]) {
      segments.push({ length: t - start, mood: moods[start] });
      start = t;
    }
  }
  return segments;
}

interface ScreenResult {
  symbol: string;
  numObservations: number;
  trainSize: number;
  testSize: number;
  finalLogLikelihood: number;
  crash: GaussianParams;
  calm: GaussianParams;
  up: GaussianParams;
  avgSegmentLengthAll: number;
  avgUpSegmentLength: number;
  maeAll: number;
  maeSegStarts: number;
  nSegStarts: number;
  relativeMae: number;
  regimeSeparation: number;
  combinedScore: number;
}

const results: ScreenResult[] = [];

for (let i = 0; i < topStocks.length; i++) {
  const symbol = topStocks[i];
  const path = resolve(DATA_DIR, "daily-ohlcv", "daily-ohlcv", `${symbol}.json`);

  if (!existsSync(path)) {
    log(`[${i + 1}/${topStocks.length}] ${symbol}: skipped (no data file)`);
    continue;
  }

  try {
    const ohlcv = JSON.parse(readFileSync(path, "utf-8")) as OHLCV[];
    const closes = ohlcv.map((c) => c.close);
    const observations = computeLogReturns(closes);

    if (observations.length < MIN_OBSERVATIONS) {
      log(`[${i + 1}/${topStocks.length}] ${symbol}: skipped (only ${observations.length} observations)`);
      continue;
    }

    const trainSize = Math.floor(observations.length * TRAIN_FRACTION);
    const trainObs = observations.slice(0, trainSize);
    const testObs = observations.slice(trainSize);

    const init = initParams(trainObs);
    const result = trainHSMM(trainObs, init.A, init.pi, init.durations, init.emissionParams, 30);

    const finalLogLikelihood = result.logLikelihoods[result.logLikelihoods.length - 1];
    if (!isFinite(finalLogLikelihood)) {
      log(`[${i + 1}/${topStocks.length}] ${symbol}: skipped (degenerate fit, non-finite log-likelihood)`);
      continue;
    }

    // causal duration prediction on the test split
    const expandedA = buildExpandedA(result.A, result.durations);
    const expandedPi = buildExpandedPi(uniformPi, result.durations);
    const expandedEmissions = buildExpandedEmissions(result.emissionParams, D);

    const logAlpha = forwardLogAlpha(testObs, expandedA, expandedPi, expandedEmissions);
    const testDecoded = viterbiHSMM(testObs, result.A, uniformPi, result.durations, result.emissionParams);

    const T = testObs.length;
    const predicted: number[] = Array(T);
    for (let t = 0; t < T; t++) {
      const logNorm = logSumExp(logAlpha[t]);
      let expected = 0;
      for (let state = 0; state < logAlpha[t].length; state++) {
        expected += remainingDurationOf(state, D) * Math.exp(logAlpha[t][state] - logNorm);
      }
      predicted[t] = expected;
    }

    const actual: number[] = Array(T);
    for (let t = 0; t < T; t++) {
      let j = t;
      while (j < T - 1 && testDecoded.moods[j + 1] === testDecoded.moods[t]) j++;
      actual[t] = j - t + 1;
    }

    const maeAll = predicted.reduce((sum, p, t) => sum + Math.abs(p - actual[t]), 0) / T;

    let nSegStarts = 0;
    let segMaeSum = 0;
    for (let t = 0; t < T; t++) {
      if (t === 0 || testDecoded.moods[t] !== testDecoded.moods[t - 1]) {
        segMaeSum += Math.abs(predicted[t] - actual[t]);
        nSegStarts++;
      }
    }
    const maeSegStarts = segMaeSum / nSegStarts;

    // segment-length stats over the train period
    const trainDecoded = viterbiHSMM(trainObs, result.A, result.pi, result.durations, result.emissionParams);
    const segments = segmentLengths(trainDecoded.moods);
    const avgSegmentLengthAll = segments.reduce((sum, s) => sum + s.length, 0) / segments.length;

    // label regimes by sorting emission means ascending: crash, calm, up
    const order = [0, 1, 2].sort((a, b) => result.emissionParams[a].mean - result.emissionParams[b].mean);
    const [crashIdx, calmIdx, upIdx] = order;
    const crash = result.emissionParams[crashIdx];
    const calm = result.emissionParams[calmIdx];
    const up = result.emissionParams[upIdx];

    const upSegments = segments.filter((s) => s.mood === upIdx);
    const avgUpSegmentLength = upSegments.length > 0
      ? upSegments.reduce((sum, s) => sum + s.length, 0) / upSegments.length
      : 0;

    const avgStd = (Math.sqrt(crash.variance) + Math.sqrt(calm.variance) + Math.sqrt(up.variance)) / 3;
    const regimeSeparation = (up.mean - crash.mean) / avgStd;
    const relativeMae = maeSegStarts / avgSegmentLengthAll;
    const combinedScore = regimeSeparation / (relativeMae + 1e-6);

    const row: ScreenResult = {
      symbol,
      numObservations: observations.length,
      trainSize,
      testSize: T,
      finalLogLikelihood,
      crash,
      calm,
      up,
      avgSegmentLengthAll,
      avgUpSegmentLength,
      maeAll,
      maeSegStarts,
      nSegStarts,
      relativeMae,
      regimeSeparation,
      combinedScore,
    };
    results.push(row);

    appendFileSync(CSV_PATH, [
      row.symbol, row.numObservations, row.trainSize, row.testSize, row.finalLogLikelihood.toFixed(3),
      row.crash.mean.toFixed(6), row.crash.variance.toFixed(6),
      row.calm.mean.toFixed(6), row.calm.variance.toFixed(6),
      row.up.mean.toFixed(6), row.up.variance.toFixed(6),
      row.avgSegmentLengthAll.toFixed(3), row.avgUpSegmentLength.toFixed(3),
      row.maeAll.toFixed(3), row.maeSegStarts.toFixed(3), row.nSegStarts,
      row.relativeMae.toFixed(4), row.regimeSeparation.toFixed(4), row.combinedScore.toFixed(4),
    ].join(",") + "\n");

    log(`[${i + 1}/${topStocks.length}] ${symbol}: combinedScore=${combinedScore.toFixed(3)} (sep=${regimeSeparation.toFixed(2)}, relMae=${relativeMae.toFixed(3)})`);
  } catch (err) {
    log(`[${i + 1}/${topStocks.length}] ${symbol}: error - ${(err as Error).message}`);
  }
}

const top10 = [...results].sort((a, b) => b.combinedScore - a.combinedScore).slice(0, 10);

console.log(`\n=== Top 10 (of ${results.length} screened) ===`);
for (const r of top10) {
  console.log(`\n${r.symbol}: combinedScore=${r.combinedScore.toFixed(3)}`);
  console.log(`  regimes: crash(mean=${r.crash.mean.toFixed(5)}, var=${r.crash.variance.toFixed(6)}), calm(mean=${r.calm.mean.toFixed(5)}, var=${r.calm.variance.toFixed(6)}), up(mean=${r.up.mean.toFixed(5)}, var=${r.up.variance.toFixed(6)})`);
  console.log(`  avg segment length: all=${r.avgSegmentLengthAll.toFixed(1)} days, up=${r.avgUpSegmentLength.toFixed(1)} days`);
  console.log(`  duration MAE: all=${r.maeAll.toFixed(2)} days, segment-starts=${r.maeSegStarts.toFixed(2)} days (relative=${r.relativeMae.toFixed(3)})`);
  console.log(`  regime separation: ${r.regimeSeparation.toFixed(2)}`);
}
