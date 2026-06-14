import "../../../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import BaseScript from "../../base-script.ts";
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
const MIN_OBSERVATIONS = 1000;
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

interface Stage1Result {
  symbol: string;
  observations: number[];
  combinedScore: number;
}

class HsmmWeeklyRankScript extends BaseScript {
  private candidateCount = 0;
  private stage1Count = 0;

  get scriptName(): string {
    return "hsmm-weekly-rank";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      "Candidates": this.candidateCount,
      "Stage 1 survivors": this.stage1Count,
    };
  }

  protected async run(): Promise<void> {
    const candidates = await this.getCandidates();
    this.candidateCount = candidates.length;
    this.log.info(`${candidates.length} candidates for stage 1 screening`);

    const survivors: Stage1Result[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const symbol = candidates[i];
      try {
        const result = this.runStage1(symbol);
        if (result) survivors.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`${symbol} — stage 1 failed: ${msg}`);
      }
      if ((i + 1) % 25 === 0) this.log.info(`Stage 1 progress: ${i + 1}/${candidates.length}`);
    }

    survivors.sort((a, b) => b.combinedScore - a.combinedScore);
    this.stage1Count = survivors.length;

    this.log.info(`Stage 1 complete — ${survivors.length}/${candidates.length} survived`);
    for (const s of survivors.slice(0, 10)) {
      this.log.info(`  ${s.symbol}: combinedScore=${s.combinedScore.toFixed(3)}`);
    }
  }

  private async getCandidates(): Promise<string[]> {
    const symbolsArg = process.argv.find((a) => a.startsWith("--symbols="));
    if (symbolsArg) {
      return symbolsArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean);
    }
    const stocks = await this.firebase.getAllStocks();
    return Object.values(stocks).filter((s) => s.isTopStock).map((s) => s.symbol);
  }

  /**
   * Cheap single 80/20 fit + sanity filters, ported from screen-stocks.ts but
   * reading the production flat data path and using a stricter observation floor.
   */
  private runStage1(symbol: string): Stage1Result | null {
    const path = resolve(DATA_DIR, "daily-ohlcv", `${symbol}.json`);
    if (!existsSync(path)) return null;

    const ohlcv = JSON.parse(readFileSync(path, "utf-8")) as OHLCV[];
    const closes = ohlcv.map((c) => c.close);
    const observations = computeLogReturns(closes);
    if (observations.length < MIN_OBSERVATIONS) return null;

    const trainSize = Math.floor(observations.length * 0.8);
    const trainObs = observations.slice(0, trainSize);
    const testObs = observations.slice(trainSize);

    const init = initParams(trainObs);
    const result = trainHSMM(trainObs, init.A, init.pi, init.durations, init.emissionParams, 30);

    const finalLogLikelihood = result.logLikelihoods[result.logLikelihoods.length - 1];
    if (!isFinite(finalLogLikelihood)) return null;

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

    let nSegStarts = 0;
    let segMaeSum = 0;
    for (let t = 0; t < T; t++) {
      if (t === 0 || testDecoded.moods[t] !== testDecoded.moods[t - 1]) {
        segMaeSum += Math.abs(predicted[t] - actual[t]);
        nSegStarts++;
      }
    }
    const maeSegStarts = segMaeSum / nSegStarts;

    const trainDecoded = viterbiHSMM(trainObs, result.A, result.pi, result.durations, result.emissionParams);
    const segments = segmentLengths(trainDecoded.moods);
    const avgSegmentLengthAll = segments.reduce((sum, s) => sum + s.length, 0) / segments.length;

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

    if (avgUpSegmentLength < 4 || up.mean < 0.001 || up.mean > 0.02 || up.variance <= 0.0001 || relativeMae > 1.0) {
      return null;
    }

    return { symbol, observations, combinedScore };
  }
}

new HsmmWeeklyRankScript().start();
