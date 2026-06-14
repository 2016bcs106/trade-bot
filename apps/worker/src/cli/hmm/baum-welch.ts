import { backwardLogBeta, computeLogGamma, computeLogXi, forwardLogAlpha } from "./forward-backward";
import { GaussianParams } from "./types/gaussian-params";
import { logSumExp } from "./utils/math";

export function reEstimatePi(logGamma: number[][]): number[] {
  return logGamma[0].map((value) => Math.exp(value));
}

export function reEstimateA(
  logGamma: number[][],
  logXi: number[][][],
): number[][] {
  const A: number[][] = Array(logXi[0].length);
  for (let i = 0; i < logXi[0].length; i++) {
    A[i] = Array(logXi[0].length);
    for (let j = 0; j < logXi[0].length; j++) {
      let xiSum = 0;
      let gammaSum = 0;

      for (let t = 0; t < logXi.length; t++) {
        xiSum += Math.exp(logXi[t][i][j]);
        gammaSum += Math.exp(logGamma[t][i]);
      }

      A[i][j] = xiSum / gammaSum;
    }
  }
  return A;
}

export function reEstimateEmissions(
  observations: number[],
  logGamma: number[][],
): GaussianParams[] {
  const emissions: GaussianParams[] = Array(
    logGamma[0].length,
  );

  for (let i = 0; i < logGamma[0].length; i++) {
    let gammaCrossObservationsSum = 0;
    let gammaSum = 0;
    for (let t = 0; t < logGamma.length; t++) {
      gammaCrossObservationsSum += Math.exp(logGamma[t][i]) * observations[t];
      gammaSum += Math.exp(logGamma[t][i]);
    }

    const mean = gammaCrossObservationsSum / gammaSum;

    let gammaCrossSquareOfObservationsMinusMean = 0;
    for (let t = 0; t < logGamma.length; t++) {
      gammaCrossSquareOfObservationsMinusMean +=
        Math.exp(logGamma[t][i]) * Math.pow(observations[t] - mean, 2);
    }

    emissions[i] = {
      mean,
      variance: gammaCrossSquareOfObservationsMinusMean / gammaSum,
    };
  }

  return emissions;
}

export function trainHMM(
  observations: number[],
  A: number[][],
  pi: number[],
  emissionParams: GaussianParams[],
  numIterations: number,
) {
    const logLikelihoods = [];
    for (let iteration = 0; iteration < numIterations; iteration++) {
        const logAlpha = forwardLogAlpha(observations, A, pi, emissionParams);
        const logBeta = backwardLogBeta(observations, A, emissionParams);
        const logGamma = computeLogGamma(logAlpha, logBeta);
        const logXi = computeLogXi(observations, A, emissionParams, logAlpha, logBeta);
        const logLikelihood = logSumExp(logAlpha[observations.length - 1]);

        pi = reEstimatePi(logGamma);
        A = reEstimateA(logGamma, logXi);
        emissionParams = reEstimateEmissions(observations, logGamma);
        logLikelihoods.push(logLikelihood);
    }

    return {
        pi,
        A,
        emissionParams,
        logLikelihoods,
    };
}
