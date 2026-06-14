import { GaussianParams } from "../types/gaussian-params.ts";

/**
 * HSMM via state augmentation: each expanded state is a (mood, remainingDuration)
 * pair. Index encoding: expandedIndex = mood * maxDuration + (remainingDuration - 1).
 */
export function expandedIndex(mood: number, remainingDuration: number, maxDuration: number): number {
  return mood * maxDuration + (remainingDuration - 1);
}

export function moodOf(expandedState: number, maxDuration: number): number {
  return Math.floor(expandedState / maxDuration);
}

export function remainingDurationOf(expandedState: number, maxDuration: number): number {
  return (expandedState % maxDuration) + 1;
}

/**
 * Expanded transition matrix:
 * - remainingDuration > 1: deterministic countdown to (mood, remainingDuration - 1).
 * - remainingDuration === 1: switch to a new mood j' (A[j][j'], j' != j) and draw
 *   its initial duration (durations[j'][d' - 1]).
 */
export function buildExpandedA(A: number[][], durations: number[][]): number[][] {
  const N = A.length;
  const D = durations[0].length;
  const size = N * D;
  const expandedA: number[][] = Array.from({ length: size }, () => Array(size).fill(0));

  for (let j = 0; j < N; j++) {
    for (let r = 1; r <= D; r++) {
      const from = expandedIndex(j, r, D);

      if (r > 1) {
        expandedA[from][expandedIndex(j, r - 1, D)] = 1;
      } else {
        for (let j2 = 0; j2 < N; j2++) {
          if (j2 === j) continue;
          for (let d2 = 1; d2 <= D; d2++) {
            expandedA[from][expandedIndex(j2, d2, D)] = A[j][j2] * durations[j2][d2 - 1];
          }
        }
      }
    }
  }

  return expandedA;
}

export function buildExpandedPi(pi: number[], durations: number[][]): number[] {
  const N = pi.length;
  const D = durations[0].length;
  const expandedPi: number[] = Array(N * D).fill(0);

  for (let j = 0; j < N; j++) {
    for (let d = 1; d <= D; d++) {
      expandedPi[expandedIndex(j, d, D)] = pi[j] * durations[j][d - 1];
    }
  }

  return expandedPi;
}

export function buildExpandedEmissions(emissionParams: GaussianParams[], maxDuration: number): GaussianParams[] {
  const N = emissionParams.length;
  const expandedEmissions: GaussianParams[] = Array(N * maxDuration);

  for (let j = 0; j < N; j++) {
    for (let r = 1; r <= maxDuration; r++) {
      expandedEmissions[expandedIndex(j, r, maxDuration)] = emissionParams[j];
    }
  }

  return expandedEmissions;
}
