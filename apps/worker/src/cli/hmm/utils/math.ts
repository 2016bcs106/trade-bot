export function logSumExp(logValues: number[]): number {
    const max = Math.max(...logValues);

    if (max === -Infinity) {
        return -Infinity;
    }

    return max + Math.log(logValues.reduce((accumulator, current) => accumulator + Math.exp(current - max), 0));
}

export function gaussianLogPdf(x: number, mean: number, variance: number): number {
    return -0.5 * Math.log(2 * Math.PI * variance) - ((x - mean) * (x - mean)) / (2 * variance);
}

export function sampleCategorical(probabilities: number[]): number {
    const cumulativeProbabilities = Array(probabilities.length);
    
    probabilities.forEach((item: number, index: number) => {
        if (index === 0) {
            cumulativeProbabilities[index] = item;
        } else {
            cumulativeProbabilities[index] = item + cumulativeProbabilities[index - 1];
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
            result[i] = sampleNextState(result[i-1], A);
        }
    }

    return result;
}

export function sampleGaussian(mean: number, variance: number): number {
    const z = Math.sqrt(-2 * Math.log(Math.random() + Number.EPSILON)) * Math.cos(2 * Math.PI * Math.random());
    return mean + Math.sqrt(variance) * z;
}

export function generateObservations(A: number[][], pi: number[], emissionParams: { mean: number, variance: number}[], T: number): { states: number[], observations: number[] } {
    const states = simulateChain(A, pi, T);
    return {
        states: states,
        observations: states.map(state => {
            return sampleGaussian(emissionParams[state].mean, emissionParams[state].variance)
        })
    };
}

export function forwardLogAlpha(observations: number[], A: number[][], pi: number[], emissionParams: { mean: number, variance: number} []): number[][] {
    const logAlpha: number[][] = [];
    
    for (let t = 0; t < observations.length; t++) {
        let logAlphaTemp = [];
        for (let j = 0; j < pi.length; j++) {
            if (t === 0) {
                logAlphaTemp.push(Math.log(pi[j]) + gaussianLogPdf(observations[0], emissionParams[j].mean, emissionParams[j].variance));
            } else {
                logAlphaTemp.push(
                    logSumExp(Array.from({ length: pi.length }, (_, i) => logAlpha.slice(-1)[0][i] + Math.log(A[i][j])))
                    + gaussianLogPdf(observations[t], emissionParams[j].mean, emissionParams[j].variance)
                );
            }
        }
        logAlpha.push(logAlphaTemp);
    }

    return logAlpha;
}
