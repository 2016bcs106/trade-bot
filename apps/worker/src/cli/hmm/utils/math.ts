export function logSumExp(logValues: number[]): number {
  const max = Math.max(...logValues);

  if (max === -Infinity) {
    return -Infinity;
  }

  return (
    max +
    Math.log(
      logValues.reduce(
        (accumulator, current) => accumulator + Math.exp(current - max),
        0,
      ),
    )
  );
}

export function gaussianLogPdf(
  x: number,
  mean: number,
  variance: number,
): number {
  return (
    -0.5 * Math.log(2 * Math.PI * variance) -
    ((x - mean) * (x - mean)) / (2 * variance)
  );
}
