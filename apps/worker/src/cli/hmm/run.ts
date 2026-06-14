import { trainHMM } from "./baum-welch.ts";
import { GaussianParams } from "./types/gaussian-params.ts";
import { generateObservations } from "./utils/sampling.ts";

const trueA = [
  [0.9, 0.1],
  [0.1, 0.9],
];
const truePi = [0.5, 0.5];
const trueEmissions: GaussianParams[] = [
  { mean: -2, variance: 1 },
  { mean: 2, variance: 1 },
];

const { observations } = generateObservations(trueA, truePi, trueEmissions, 500);

const initA = [
  [0.5, 0.5],
  [0.5, 0.5],
];
const initPi = [0.5, 0.5];
const initEmissions: GaussianParams[] = [
  { mean: -1, variance: 2 },
  { mean: 1, variance: 2 },
];

const result = trainHMM(observations, initA, initPi, initEmissions, 30);

console.log("log-likelihoods:", result.logLikelihoods.map((x) => x.toFixed(3)));
console.log("learned A:", result.A);
console.log("true A:", trueA);
console.log("learned pi:", result.pi);
console.log("true pi:", truePi);
console.log("learned emissions:", result.emissionParams);
console.log("true emissions:", trueEmissions);
