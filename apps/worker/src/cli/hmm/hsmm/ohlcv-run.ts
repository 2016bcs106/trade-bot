import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync } from "fs";
import { GaussianParams } from "../types/gaussian-params.ts";
import { OHLCV } from "../../../types/market-data/ohlcv.ts";
import { computeLogReturns } from "../utils/returns.ts";
import { trainHSMM } from "./baum-welch.ts";
import { viterbiHSMM } from "./decode.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "..", "..", "..", "..", "data");

const SYMBOL = "ADANIENT";
const N = 3;
const D = 20;

const ohlcv = JSON.parse(readFileSync(resolve(DATA_DIR, "daily-ohlcv", `${SYMBOL}.json`), "utf-8")) as OHLCV[];
const closes = ohlcv.map((c) => c.close);
const observations = computeLogReturns(closes);

const mean = observations.reduce((sum, x) => sum + x, 0) / observations.length;
const variance = observations.reduce((sum, x) => sum + (x - mean) ** 2, 0) / observations.length;
const std = Math.sqrt(variance);

const initA = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 0 : 1 / (N - 1))));
const initPi = Array(N).fill(1 / N);
const initDurations = Array.from({ length: N }, () => Array(D).fill(1 / D));
const initEmissions: GaussianParams[] = [
  { mean: mean - std * 0.5, variance: variance * 2 }, // crash / high-vol
  { mean, variance: variance * 0.3 }, // calm
  { mean: mean + std * 0.5, variance }, // trending up
];

const result = trainHSMM(observations, initA, initPi, initDurations, initEmissions, 30);

console.log("log-likelihoods:", result.logLikelihoods.map((x) => x.toFixed(3)));
console.log("learned A:", result.A);
console.log("learned durations:", result.durations.map((row) => row.map((x) => x.toFixed(3))));
console.log("learned emissions:", result.emissionParams);

const decoded = viterbiHSMM(observations, result.A, result.pi, result.durations, result.emissionParams);

const rows = ["date,close,logReturn,regime,remainingDuration"];
for (let t = 0; t < observations.length; t++) {
  const date = ohlcv[t + 1].timestamp.split(" ")[0];
  rows.push(`${date},${closes[t + 1]},${observations[t]},${decoded.moods[t]},${decoded.remainingDurations[t]}`);
}
writeFileSync(resolve(DATA_DIR, `hsmm-regimes-${SYMBOL}.csv`), rows.join("\n"));
console.log(`wrote ${rows.length - 1} rows to data/hsmm-regimes-${SYMBOL}.csv`);
