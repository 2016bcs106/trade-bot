import { reEstimateEmissions, reEstimatePi } from "../baum-welch.ts";
import { backwardLogBeta, computeLogGamma, computeLogXi, forwardLogAlpha } from "../forward-backward.ts";
import { GaussianParams } from "../types/gaussian-params.ts";
import { logSumExp } from "../utils/math.ts";
import { buildExpandedA, buildExpandedEmissions, buildExpandedPi, expandedIndex } from "./expand.ts";

/**
 * Collapse the expanded (mood x remainingDuration) logGamma into a per-mood
 * logGamma by summing (logSumExp) over remainingDuration for each mood.
 */
export function aggregateLogGammaByMood(logGammaExpanded: number[][], N: number, D: number): number[][] {
  const T = logGammaExpanded.length;
  const logGammaMood: number[][] = Array(T);

  for (let t = 0; t < T; t++) {
    logGammaMood[t] = Array(N);
    for (let j = 0; j < N; j++) {
      logGammaMood[t][j] = logSumExp(
        Array.from({ length: D }, (_, r) => logGammaExpanded[t][expandedIndex(j, r + 1, D)]),
      );
    }
  }

  return logGammaMood;
}

/**
 * Re-estimate A[j][j'] (j' != j, A[j][j] stays 0) from the expanded chain:
 * a mood switch only ever happens from a (j, remaining=1) state.
 */
export function reEstimateHSMM_A(logGammaExpanded: number[][], logXiExpanded: number[][][], N: number, D: number): number[][] {
  const A: number[][] = Array.from({ length: N }, () => Array(N).fill(0));

  for (let j = 0; j < N; j++) {
    const from = expandedIndex(j, 1, D);

    let denom = 0;
    for (let t = 0; t < logXiExpanded.length; t++) {
      denom += Math.exp(logGammaExpanded[t][from]);
    }

    for (let j2 = 0; j2 < N; j2++) {
      if (j2 === j) continue;

      let numer = 0;
      for (let t = 0; t < logXiExpanded.length; t++) {
        for (let d2 = 1; d2 <= D; d2++) {
          numer += Math.exp(logXiExpanded[t][from][expandedIndex(j2, d2, D)]);
        }
      }

      A[j][j2] = numer / denom;
    }
  }

  return A;
}

/**
 * Re-estimate durations[j][d] = P(duration = d | mood = j) from the expanded
 * chain: a segment of mood j with duration d is "entered" either as the very
 * first segment (logGammaExpanded[0]) or via a mood switch from (i, remaining=1),
 * i != j, into (j, d).
 */
export function reEstimateDurations(logGammaExpanded: number[][], logXiExpanded: number[][][], N: number, D: number): number[][] {
  const durations: number[][] = Array.from({ length: N }, () => Array(D).fill(0));

  for (let j = 0; j < N; j++) {
    let total = 0;
    for (let d = 1; d <= D; d++) {
      const to = expandedIndex(j, d, D);
      let count = Math.exp(logGammaExpanded[0][to]);

      for (let t = 0; t < logXiExpanded.length; t++) {
        for (let i = 0; i < N; i++) {
          if (i === j) continue;
          count += Math.exp(logXiExpanded[t][expandedIndex(i, 1, D)][to]);
        }
      }

      durations[j][d - 1] = count;
      total += count;
    }

    for (let d = 0; d < D; d++) {
      durations[j][d] /= total;
    }
  }

  return durations;
}

export function trainHSMM(
  observations: number[],
  A: number[][],
  pi: number[],
  durations: number[][],
  emissionParams: GaussianParams[],
  numIterations: number,
) {
  const N = A.length;
  const D = durations[0].length;
  const logLikelihoods: number[] = [];

  for (let iteration = 0; iteration < numIterations; iteration++) {
    const expandedA = buildExpandedA(A, durations);
    const expandedPi = buildExpandedPi(pi, durations);
    const expandedEmissions = buildExpandedEmissions(emissionParams, D);

    const logAlpha = forwardLogAlpha(observations, expandedA, expandedPi, expandedEmissions);
    const logBeta = backwardLogBeta(observations, expandedA, expandedEmissions);
    const logGamma = computeLogGamma(logAlpha, logBeta);
    const logXi = computeLogXi(observations, expandedA, expandedEmissions, logAlpha, logBeta);

    logLikelihoods.push(logSumExp(logAlpha[observations.length - 1]));

    const logGammaMood = aggregateLogGammaByMood(logGamma, N, D);

    pi = reEstimatePi(logGammaMood);
    emissionParams = reEstimateEmissions(observations, logGammaMood);
    A = reEstimateHSMM_A(logGamma, logXi, N, D);
    durations = reEstimateDurations(logGamma, logXi, N, D);
  }

  return { A, pi, durations, emissionParams, logLikelihoods };
}
