import { GaussianParams } from "./types/gaussian-params.ts";
import { gaussianLogPdf } from "./utils/math.ts";

export function viterbi(
  observations: number[],
  A: number[][],
  pi: number[],
  emissionParams: GaussianParams[],
): number[] {
  const T = observations.length;
  const N = pi.length;

  const delta: number[][] = Array(T);
  const psi: number[][] = Array(T);

  delta[0] = Array(N);
  psi[0] = Array(N);
  for (let j = 0; j < N; j++) {
    delta[0][j] =
      Math.log(pi[j]) +
      gaussianLogPdf(observations[0], emissionParams[j].mean, emissionParams[j].variance);
    psi[0][j] = -1;
  }

  for (let t = 1; t < T; t++) {
    delta[t] = Array(N);
    psi[t] = Array(N);
    for (let j = 0; j < N; j++) {
      let best = -Infinity;
      let bestI = -1;
      for (let i = 0; i < N; i++) {
        const score = delta[t - 1][i] + Math.log(A[i][j]);
        if (score > best) {
          best = score;
          bestI = i;
        }
      }
      delta[t][j] =
        best +
        gaussianLogPdf(observations[t], emissionParams[j].mean, emissionParams[j].variance);
      psi[t][j] = bestI;
    }
  }

  const states: number[] = Array(T);
  let bestLast = 0;
  for (let j = 1; j < N; j++) {
    if (delta[T - 1][j] > delta[T - 1][bestLast]) {
      bestLast = j;
    }
  }
  states[T - 1] = bestLast;

  for (let t = T - 2; t >= 0; t--) {
    states[t] = psi[t + 1][states[t + 1]];
  }

  return states;
}
