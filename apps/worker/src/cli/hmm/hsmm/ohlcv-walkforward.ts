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
const TRAIN_FRACTION = 0.8;

const ohlcv = JSON.parse(readFileSync(resolve(DATA_DIR, "daily-ohlcv", `${SYMBOL}.json`), "utf-8")) as OHLCV[];
const closes = ohlcv.map((c) => c.close);
const observations = computeLogReturns(closes);

const trainSize = Math.floor(observations.length * TRAIN_FRACTION);
const trainObservations = observations.slice(0, trainSize);
const testObservations = observations.slice(trainSize);

console.log(`train: ${trainObservations.length} days (${ohlcv[1].timestamp.split(" ")[0]} -> ${ohlcv[trainSize].timestamp.split(" ")[0]})`);
console.log(`test:  ${testObservations.length} days (${ohlcv[trainSize + 1].timestamp.split(" ")[0]} -> ${ohlcv[ohlcv.length - 1].timestamp.split(" ")[0]})`);

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

const init = initParams(trainObservations);
const result = trainHSMM(trainObservations, init.A, init.pi, init.durations, init.emissionParams, 30);

console.log("log-likelihoods:", result.logLikelihoods.map((x) => x.toFixed(3)));
console.log("learned emissions (train-only):", result.emissionParams);

// ─── Duration-prediction error on the held-out test period ────────────────
// "predicted" = filtered (causal, no-lookahead) expected remaining duration
// E[remainingDuration_t | observations[0..t]], from a single forward pass.
// "actual" = remaining run-length of the smoothed (Viterbi) regime at t —
// the best available proxy for ground truth since true regimes are unknown.

const uniformPi = Array(N).fill(1 / N);
const expandedA = buildExpandedA(result.A, result.durations);
const expandedPi = buildExpandedPi(uniformPi, result.durations);
const expandedEmissions = buildExpandedEmissions(result.emissionParams, D);

const logAlpha = forwardLogAlpha(testObservations, expandedA, expandedPi, expandedEmissions);
const testDecoded = viterbiHSMM(testObservations, result.A, uniformPi, result.durations, result.emissionParams);

const T = testObservations.length;
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

const mae = predicted.reduce((sum, p, t) => sum + Math.abs(p - actual[t]), 0) / T;
const bias = predicted.reduce((sum, p, t) => sum + (p - actual[t]), 0) / T;
console.log(`\nfiltered duration prediction (all days): MAE=${mae.toFixed(2)} days, bias (predicted - actual)=${bias.toFixed(2)} days`);

// segment starts only — the actual decision point for "how long will this regime last?"
let segmentStarts = 0;
let segMae = 0;
for (let t = 0; t < T; t++) {
  if (t === 0 || testDecoded.moods[t] !== testDecoded.moods[t - 1]) {
    segMae += Math.abs(predicted[t] - actual[t]);
    segmentStarts++;
  }
}
console.log(`filtered duration prediction (segment starts, n=${segmentStarts}): MAE=${(segMae / segmentStarts).toFixed(2)} days`);

// ─── Regime-label stability vs the full-sample fit ─────────────────────────

const fullSampleCsv = readFileSync(resolve(DATA_DIR, `hsmm-regimes-${SYMBOL}.csv`), "utf-8").trim().split("\n").slice(1);
const fullSampleRegimes = fullSampleCsv.map((line) => parseInt(line.split(",")[3], 10));

const trainDecoded = viterbiHSMM(trainObservations, result.A, result.pi, result.durations, result.emissionParams);

let agree = 0;
for (let t = 0; t < trainObservations.length; t++) {
  if (trainDecoded.moods[t] === fullSampleRegimes[t]) agree++;
}
console.log(`\nregime-label agreement (train-only fit vs full-sample fit, over train period): ${(agree / trainObservations.length * 100).toFixed(1)}%`);
