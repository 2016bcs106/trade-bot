import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
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

const SYMBOL = "ADANIENT";
const N = 3;
const D = 20;
const FOLDS = 5;

const ohlcv = JSON.parse(readFileSync(resolve(DATA_DIR, "daily-ohlcv", `${SYMBOL}.json`), "utf-8")) as OHLCV[];
const closes = ohlcv.map((c) => c.close);
const observations = computeLogReturns(closes);

const initialTrainSize = Math.floor(observations.length * 0.8);
const foldSize = Math.floor((observations.length - initialTrainSize) / FOLDS);
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

let prevTrainDecode: { size: number; moods: number[] } | null = null;
const foldMaes: number[] = [];
const foldSegMaes: number[] = [];
const foldStabilities: number[] = [];

for (let fold = 0; fold < FOLDS; fold++) {
  const trainSize = initialTrainSize + fold * foldSize;
  const testEnd = fold === FOLDS - 1 ? observations.length : trainSize + foldSize;

  const trainObs = observations.slice(0, trainSize);
  const testObs = observations.slice(trainSize, testEnd);

  const init = initParams(trainObs);
  const result = trainHSMM(trainObs, init.A, init.pi, init.durations, init.emissionParams, 30);

  // causal duration prediction on this fold's test slice (filtered, no lookahead)
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

  let segCount = 0;
  let segMaeSum = 0;
  for (let t = 0; t < T; t++) {
    if (t === 0 || testDecoded.moods[t] !== testDecoded.moods[t - 1]) {
      segMaeSum += Math.abs(predicted[t] - actual[t]);
      segCount++;
    }
  }
  const maeSeg = segMaeSum / segCount;

  // regime-label stability vs. the previous fold's fit, over the overlapping (previous) train period
  let stability: number | null = null;
  let previousTrainSize = 0;
  if (prevTrainDecode) {
    previousTrainSize = prevTrainDecode.size;
    const overlapDecoded = viterbiHSMM(trainObs.slice(0, previousTrainSize), result.A, result.pi, result.durations, result.emissionParams);
    let agree = 0;
    for (let t = 0; t < previousTrainSize; t++) {
      if (overlapDecoded.moods[t] === prevTrainDecode.moods[t]) agree++;
    }
    stability = agree / previousTrainSize;
  }

  const fullTrainDecoded = viterbiHSMM(trainObs, result.A, result.pi, result.durations, result.emissionParams);
  prevTrainDecode = { size: trainSize, moods: fullTrainDecoded.moods };

  foldMaes.push(maeAll);
  foldSegMaes.push(maeSeg);
  if (stability !== null) foldStabilities.push(stability);

  console.log(`\nfold ${fold + 1}/${FOLDS}: train=${trainSize} days, test=${T} days`);
  console.log(`  emissions:`, result.emissionParams.map((e) => ({ mean: e.mean.toFixed(5), variance: e.variance.toFixed(6) })));
  console.log(`  duration MAE: all=${maeAll.toFixed(2)} days, segment-starts(n=${segCount})=${maeSeg.toFixed(2)} days`);
  if (stability !== null) console.log(`  regime stability vs previous fold's fit (over first ${previousTrainSize} days): ${(stability * 100).toFixed(1)}%`);
}

const avg = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
console.log(`\nacross ${FOLDS} folds:`);
console.log(`  duration MAE (all days): mean=${avg(foldMaes).toFixed(2)} days`);
console.log(`  duration MAE (segment starts): mean=${avg(foldSegMaes).toFixed(2)} days`);
console.log(`  regime stability vs previous fold: mean=${(avg(foldStabilities) * 100).toFixed(1)}%`);
