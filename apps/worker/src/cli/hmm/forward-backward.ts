import { GaussianParams } from "./types/gaussian-params";
import { gaussianLogPdf, logSumExp } from "./utils/math";

/**
 * Group emission params by object identity. HSMM's expanded emission array
 * assigns the same GaussianParams object to every duration-state of a mood,
 * so deduping by reference lets us compute gaussianLogPdf once per mood
 * instead of once per expanded state.
 */
function groupEmissionParams(emissionParams: GaussianParams[]): { unique: GaussianParams[]; groupOf: number[] } {
  const unique: GaussianParams[] = [];
  const indexOf = new Map<GaussianParams, number>();
  const groupOf = emissionParams.map((p) => {
    let idx = indexOf.get(p);
    if (idx === undefined) {
      idx = unique.length;
      unique.push(p);
      indexOf.set(p, idx);
    }
    return idx;
  });
  return { unique, groupOf };
}

export function forwardLogAlpha(
  observations: number[],
  A: number[][],
  pi: number[],
  emissionParams: GaussianParams[],
): number[][] {
  const M = pi.length;
  const logA: number[][] = Array.from({ length: M }, (_, i) => Array.from({ length: M }, (_, j) => Math.log(A[i][j])));
  const { unique, groupOf } = groupEmissionParams(emissionParams);

  const logAlpha: number[][] = [];

  for (let t = 0; t < observations.length; t++) {
    const emissionLogPdf = unique.map((p) => gaussianLogPdf(observations[t], p.mean, p.variance));
    let logAlphaTemp: number[] = [];
    for (let j = 0; j < M; j++) {
      if (t === 0) {
        logAlphaTemp.push(Math.log(pi[j]) + emissionLogPdf[groupOf[j]]);
      } else {
        const prev = logAlpha[t - 1];
        logAlphaTemp.push(
          logSumExp(Array.from({ length: M }, (_, i) => prev[i] + logA[i][j])) + emissionLogPdf[groupOf[j]],
        );
      }
    }
    logAlpha.push(logAlphaTemp);
  }

  return logAlpha;
}

export function backwardLogBeta(
  observations: number[],
  A: number[][],
  emissionParams: GaussianParams[],
): number[][] {
  const M = emissionParams.length;
  const logA: number[][] = Array.from({ length: M }, (_, j) => Array.from({ length: M }, (_, i) => Math.log(A[j][i])));
  const { unique, groupOf } = groupEmissionParams(emissionParams);

  const logBeta: number[][] = Array(observations.length);

  for (let t = observations.length - 1; t >= 0; t--) {
    logBeta[t] = Array(M);
    if (t === observations.length - 1) {
      for (let j = 0; j < M; j++) logBeta[t][j] = 0;
    } else {
      const emissionLogPdf = unique.map((p) => gaussianLogPdf(observations[t + 1], p.mean, p.variance));
      for (let j = 0; j < M; j++) {
        logBeta[t][j] = logSumExp(
          Array.from({ length: M }, (_, i) => logA[j][i] + emissionLogPdf[groupOf[i]] + logBeta[t + 1][i]),
        );
      }
    }
  }

  return logBeta;
}

export function computeLogGamma(
  logAlpha: number[][],
  logBeta: number[][],
): number[][] {
  const logGamma: number[][] = Array(logAlpha.length);
  const logP = logSumExp(logAlpha[logAlpha.length - 1]);

  for (let t = 0; t < logAlpha.length; t++) {
    logGamma[t] = Array(logAlpha[0].length);
    for (let i = 0; i < logAlpha[0].length; i++) {
      logGamma[t][i] = logAlpha[t][i] + logBeta[t][i] - logP;
    }
  }

  return logGamma;
}

export function computeLogXi(
  observations: number[],
  A: number[][],
  emissionParams: GaussianParams[],
  logAlpha: number[][],
  logBeta: number[][],
  fromIndices?: number[],
): number[][][] {
  const logP = logSumExp(logAlpha[logAlpha.length - 1]);
  const M = A[0].length;
  const rows = fromIndices ?? Array.from({ length: M }, (_, i) => i);
  const logA: number[][] = Array.from({ length: M }, (_, i) => Array.from({ length: M }, (_, j) => Math.log(A[i][j])));
  const { unique, groupOf } = groupEmissionParams(emissionParams);
  const logXi: number[][][] = Array(observations.length - 1);

  for (let t = 0; t < observations.length - 1; t++) {
    const emissionLogPdf = unique.map((p) => gaussianLogPdf(observations[t + 1], p.mean, p.variance));
    logXi[t] = Array(rows.length);
    for (let k = 0; k < rows.length; k++) {
      const i = rows[k];
      logXi[t][k] = Array(M);
      for (let j = 0; j < M; j++) {
        logXi[t][k][j] = logAlpha[t][i] + logA[i][j] + emissionLogPdf[groupOf[j]] + logBeta[t + 1][j] - logP;
      }
    }
  }

  return logXi;
}
