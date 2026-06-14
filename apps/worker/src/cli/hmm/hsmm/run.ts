import { GaussianParams } from "../types/gaussian-params.ts";
import { trainHSMM } from "./baum-welch.ts";
import { viterbiHSMM } from "./decode.ts";
import { generateHSMMObservations } from "./sampling.ts";

const trueA = [
  [0, 1],
  [1, 0],
];
const truePi = [0.5, 0.5];
const trueDurations = [
  [0.1, 0.2, 0.4, 0.2, 0.1],
  [0.05, 0.15, 0.4, 0.25, 0.15],
];
const trueEmissions: GaussianParams[] = [
  { mean: -2, variance: 1 },
  { mean: 2, variance: 1 },
];

const { observations, states: trueStates, remainingDurations: trueRemaining } = generateHSMMObservations(
  trueA,
  truePi,
  trueDurations,
  trueEmissions,
  2000,
);

const initA = [
  [0, 1],
  [1, 0],
];
const initPi = [0.5, 0.5];
const initDurations = [
  [0.2, 0.2, 0.2, 0.2, 0.2],
  [0.2, 0.2, 0.2, 0.2, 0.2],
];
const initEmissions: GaussianParams[] = [
  { mean: -1, variance: 2 },
  { mean: 1, variance: 2 },
];

const result = trainHSMM(observations, initA, initPi, initDurations, initEmissions, 20);

console.log("log-likelihoods:", result.logLikelihoods.map((x) => x.toFixed(3)));
console.log("learned A:", result.A);
console.log("true A:", trueA);
console.log("learned durations:", result.durations.map((row) => row.map((x) => x.toFixed(3))));
console.log("true durations:", trueDurations);
console.log("learned emissions:", result.emissionParams);
console.log("true emissions:", trueEmissions);

const decoded = viterbiHSMM(observations, result.A, result.pi, result.durations, result.emissionParams);

let moodMatches = 0;
for (let t = 0; t < observations.length; t++) {
  if (decoded.moods[t] === trueStates[t]) moodMatches++;
}
console.log("decoded mood accuracy:", (moodMatches / observations.length).toFixed(3));

console.log("decoded remainingDuration (first 30):", decoded.remainingDurations.slice(0, 30));
console.log("true remainingDuration (first 30):", trueRemaining.slice(0, 30));
