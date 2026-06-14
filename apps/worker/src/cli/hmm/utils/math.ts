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

export function sampleCategorical(probabilities: number[]): number {
  const cumulativeProbabilities = Array(probabilities.length);

  probabilities.forEach((item: number, index: number) => {
    if (index === 0) {
      cumulativeProbabilities[index] = item;
    } else {
      cumulativeProbabilities[index] =
        item + cumulativeProbabilities[index - 1];
    }
  });

  const random = Math.random() * cumulativeProbabilities.slice(-1)[0];

  for (let i = 0; i < cumulativeProbabilities.length; i++) {
    if (random < cumulativeProbabilities[i]) {
      return i;
    }
  }

  return -1;
}

export function sampleNextState(currentState: number, A: number[][]): number {
  return sampleCategorical(A[currentState]);
}

export function simulateChain(A: number[][], pi: number[], T: number) {
  const result = Array(T);

  for (let i = 0; i < T; i++) {
    if (i === 0) {
      result[0] = sampleCategorical(pi);
    } else {
      result[i] = sampleNextState(result[i - 1], A);
    }
  }

  return result;
}

export function sampleGaussian(mean: number, variance: number): number {
  const z =
    Math.sqrt(-2 * Math.log(Math.random() + Number.EPSILON)) *
    Math.cos(2 * Math.PI * Math.random());
  return mean + Math.sqrt(variance) * z;
}

export function generateObservations(
  A: number[][],
  pi: number[],
  emissionParams: { mean: number; variance: number }[],
  T: number,
): { states: number[]; observations: number[] } {
  const states = simulateChain(A, pi, T);
  return {
    states: states,
    observations: states.map((state) => {
      return sampleGaussian(
        emissionParams[state].mean,
        emissionParams[state].variance,
      );
    }),
  };
}

export function forwardLogAlpha(
  observations: number[],
  A: number[][],
  pi: number[],
  emissionParams: { mean: number; variance: number }[],
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
  emissionParams: { mean: number; variance: number }[],
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
  emissionParams: { mean: number; variance: number }[],
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

export function reEstimatePi(logGamma: number[][]): number[] {
  return logGamma[0].map((value) => Math.exp(value));
}

export function reEstimateA(
  logGamma: number[][],
  logXi: number[][][],
): number[][] {
  const A: number[][] = Array(logXi[0].length);
  for (let i = 0; i < logXi[0].length; i++) {
    A[i] = Array(logXi[0].length);
    for (let j = 0; j < logXi[0].length; j++) {
      let xiSum = 0;
      let gammaSum = 0;

      for (let t = 0; t < logXi.length; t++) {
        xiSum += Math.exp(logXi[t][i][j]);
        gammaSum += Math.exp(logGamma[t][i]);
      }

      A[i][j] = xiSum / gammaSum;
    }
  }
  return A;
}

export function reEstimateEmissions(
  observations: number[],
  logGamma: number[][],
): { mean: number; variance: number }[] {
  const emissions: { mean: number; variance: number }[] = Array(
    logGamma[0].length,
  );

  for (let i = 0; i < logGamma[0].length; i++) {
    let gammaCrossObservationsSum = 0;
    let gammaSum = 0;
    for (let t = 0; t < logGamma.length; t++) {
      gammaCrossObservationsSum += Math.exp(logGamma[t][i]) * observations[t];
      gammaSum += Math.exp(logGamma[t][i]);
    }

    const mean = gammaCrossObservationsSum / gammaSum;

    let gammaCrossSquareOfObservationsMinusMean = 0;
    for (let t = 0; t < logGamma.length; t++) {
      gammaCrossSquareOfObservationsMinusMean +=
        Math.exp(logGamma[t][i]) * Math.pow(observations[t] - mean, 2);
    }

    emissions[i] = {
      mean,
      variance: gammaCrossSquareOfObservationsMinusMean / gammaSum,
    };
  }

  return emissions;
}

export function trainHMM(
  observations: number[],
  A: number[][],
  pi: number[],
  emissionParams: { mean: number; variance: number }[],
  numIterations: number,
) {
    const logLikelihoods = [];
    for (let iteration = 0; iteration < numIterations; iteration++) {
        const logAlpha = forwardLogAlpha(observations, A, pi, emissionParams);
        const logBeta = backwardLogBeta(observations, A, emissionParams);
        const logGamma = computeLogGamma(logAlpha, logBeta);
        const logXi = computeLogXi(observations, A, emissionParams, logAlpha, logBeta);
        const logLikelihood = logSumExp(logAlpha[observations.length - 1]);

        pi = reEstimatePi(logGamma);
        A = reEstimateA(logGamma, logXi);
        emissionParams = reEstimateEmissions(observations, logGamma);
        logLikelihoods.push(logLikelihood);
    }

    return {
        pi,
        A,
        emissionParams,
        logLikelihoods,
    };
}
