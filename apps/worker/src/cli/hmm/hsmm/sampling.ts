import { GaussianParams } from "../types/gaussian-params.ts";
import { sampleDuration } from "../utils/duration.ts";
import { sampleCategorical, sampleGaussian } from "../utils/sampling.ts";

export function generateHSMMObservations(
  A: number[][],
  pi: number[],
  durations: number[][],
  emissionParams: GaussianParams[],
  T: number,
): { observations: number[]; states: number[]; remainingDurations: number[] } {
  const observations: number[] = [];
  const states: number[] = [];
  const remainingDurations: number[] = [];

  let mood = sampleCategorical(pi);
  let duration = sampleDuration(durations[mood]);

  while (observations.length < T) {
    for (let remaining = duration; remaining >= 1 && observations.length < T; remaining--) {
      states.push(mood);
      remainingDurations.push(remaining);
      observations.push(sampleGaussian(emissionParams[mood].mean, emissionParams[mood].variance));
    }

    mood = sampleCategorical(A[mood]);
    duration = sampleDuration(durations[mood]);
  }

  return { observations, states, remainingDurations };
}
