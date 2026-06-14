export function computeLogReturns(closes: number[]): number[] {
  const returns: number[] = Array(closes.length - 1);

  for (let t = 0; t < closes.length - 1; t++) {
    returns[t] = Math.log(closes[t + 1] / closes[t]);
  }

  return returns;
}
