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
