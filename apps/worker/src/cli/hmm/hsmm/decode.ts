import { GaussianParams } from "../types/gaussian-params.ts";
import { viterbi } from "../viterbi.ts";
import { buildExpandedA, buildExpandedEmissions, buildExpandedPi, moodOf, remainingDurationOf } from "./expand.ts";

/**
 * Decode the most likely (mood, remainingDuration) sequence by running Viterbi
 * on the expanded chain and mapping each expanded state back to its mood and
 * remaining-duration components.
 */
export function viterbiHSMM(
  observations: number[],
  A: number[][],
  pi: number[],
  durations: number[][],
  emissionParams: GaussianParams[],
): { moods: number[]; remainingDurations: number[] } {
  const D = durations[0].length;

  const expandedA = buildExpandedA(A, durations);
  const expandedPi = buildExpandedPi(pi, durations);
  const expandedEmissions = buildExpandedEmissions(emissionParams, D);

  const expandedStates = viterbi(observations, expandedA, expandedPi, expandedEmissions);

  return {
    moods: expandedStates.map((s) => moodOf(s, D)),
    remainingDurations: expandedStates.map((s) => remainingDurationOf(s, D)),
  };
}
