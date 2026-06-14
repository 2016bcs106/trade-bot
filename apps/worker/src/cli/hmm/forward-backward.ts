import { GaussianParams } from "./types/gaussian-params";
import { gaussianLogPdf, logSumExp } from "./utils/math";

export function forwardLogAlpha(
  observations: number[],
  A: number[][],
  pi: number[],
  emissionParams: GaussianParams[],
): number[][] {
  const logAlpha: number[][] = [];

  for (let t = 0; t < observations.length; t++) {
    let logAlphaTemp: number[] = [];
    for (let j = 0; j < pi.length; j++) {
      if (t === 0) {
        logAlphaTemp.push(
          Math.log(pi[j]) +
            gaussianLogPdf(
              observations[0],
              emissionParams[j].mean,
              emissionParams[j].variance,
            ),
        );
      } else {
        logAlphaTemp.push(
          logSumExp(
            Array.from(
              { length: pi.length },
              (_, i) => logAlpha.slice(-1)[0][i] + Math.log(A[i][j]),
            ),
          ) +
            gaussianLogPdf(
              observations[t],
              emissionParams[j].mean,
              emissionParams[j].variance,
            ),
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
  const logBeta: number[][] = Array(observations.length);

  for (let t = observations.length - 1; t >= 0; t--) {
    logBeta[t] = Array(emissionParams.length);
    for (let j = 0; j < emissionParams.length; j++) {
      if (t === observations.length - 1) {
        logBeta[t][j] = 0;
      } else {
        logBeta[t][j] = logSumExp(
          Array.from({ length: emissionParams.length }, (_, i) => {
            return (
              Math.log(A[j][i]) +
              gaussianLogPdf(
                observations[t + 1],
                emissionParams[i].mean,
                emissionParams[i].variance,
              ) +
              logBeta[t + 1][i]
            );
          }),
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
): number[][][] {
  const logP = logSumExp(logAlpha[logAlpha.length - 1]);
  const logXi: number[][][] = Array(observations.length - 1);

  for (let t = 0; t < observations.length - 1; t++) {
    logXi[t] = Array(A[0].length);
    for (let i = 0; i < A[0].length; i++) {
      logXi[t][i] = Array(A[0].length);
      for (let j = 0; j < A[0].length; j++) {
        logXi[t][i][j] =
          logAlpha[t][i] +
          Math.log(A[i][j]) +
          gaussianLogPdf(
            observations[t + 1],
            emissionParams[j].mean,
            emissionParams[j].variance,
          ) +
          logBeta[t + 1][j] -
          logP;
      }
    }
  }

  return logXi;
}
