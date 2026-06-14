import { sampleCategorical } from "./sampling.ts";

export function sampleDuration(durationDist: number[]): number {
  return sampleCategorical(durationDist) + 1;
}
