import { TrainableModel } from "./trainable-model.ts";

/**
 * Ridge (L2-regularized) linear regression model.
 * Custom implementation using closed-form solution: β = (X^T X + λI)^(-1) X^T y
 *
 * Anti-overfitting:
 * - L2 regularization (ridge penalty) prevents large coefficients
 * - Feature standardization before fitting (prevents scale-dependent bias)
 * - Trains separate models for HIGH and LOW prediction
 */
export class LinearRegressionModel implements TrainableModel {
  private weightsHigh: number[] = [];
  private weightsLow: number[] = [];
  private weightsClose: number[] = [];
  private biasHigh: number = 0;
  private biasLow: number = 0;
  private biasClose: number = 0;
  private featureMeans: number[] = [];
  private featureStds: number[] = [];
  private readonly lambda: number;

  constructor(lambda: number = 1.0) {
    this.lambda = lambda;
  }

  fit(X: number[][], yHigh: number[], yLow: number[], yClose: number[] = []): void {
    const n = X.length;
    const p = X[0].length;

    // Step 1: Standardize features (zero mean, unit variance)
    this.featureMeans = new Array(p).fill(0);
    this.featureStds = new Array(p).fill(1);

    for (let j = 0; j < p; j++) {
      const col = X.map((row) => row[j]);
      this.featureMeans[j] = col.reduce((s, v) => s + v, 0) / n;
      const variance = col.reduce((s, v) => s + (v - this.featureMeans[j]) ** 2, 0) / n;
      this.featureStds[j] = Math.sqrt(variance) || 1;
    }

    const Xstd = X.map((row) => row.map((v, j) => (v - this.featureMeans[j]) / this.featureStds[j]));

    // Step 2: Compute (X^T X + λI)^(-1) X^T y using ridge formula
    // Add bias column (intercept)
    const Xaug = Xstd.map((row) => [...row, 1]); // augmented with intercept
    const pAug = p + 1;

    // X^T X
    const XtX = this.matMul(this.transpose(Xaug), Xaug);

    // Add λI (but NOT to intercept term)
    for (let i = 0; i < pAug - 1; i++) {
      XtX[i][i] += this.lambda;
    }

    // X^T y
    const XtYHigh = this.matVecMul(this.transpose(Xaug), yHigh);
    const XtYLow = this.matVecMul(this.transpose(Xaug), yLow);
    const XtYClose = yClose.length > 0 ? this.matVecMul(this.transpose(Xaug), yClose) : null;

    // Solve: β = (X^T X + λI)^(-1) X^T y
    const XtXInv = this.invertMatrix(XtX);
    if (!XtXInv) {
      // Fallback: increase lambda and try again
      for (let i = 0; i < pAug; i++) {
        XtX[i][i] += 10;
      }
      const fallbackInv = this.invertMatrix(XtX);
      if (fallbackInv) {
        const betaHigh = this.matVecMul(fallbackInv, XtYHigh);
        const betaLow = this.matVecMul(fallbackInv, XtYLow);
        this.weightsHigh = betaHigh.slice(0, p);
        this.biasHigh = betaHigh[p];
        this.weightsLow = betaLow.slice(0, p);
        this.biasLow = betaLow[p];
        if (XtYClose) {
          const betaClose = this.matVecMul(fallbackInv, XtYClose);
          this.weightsClose = betaClose.slice(0, p);
          this.biasClose = betaClose[p];
        }
      }
      return;
    }

    const betaHigh = this.matVecMul(XtXInv, XtYHigh);
    const betaLow = this.matVecMul(XtXInv, XtYLow);

    this.weightsHigh = betaHigh.slice(0, p);
    this.biasHigh = betaHigh[p];
    this.weightsLow = betaLow.slice(0, p);
    this.biasLow = betaLow[p];

    if (XtYClose) {
      const betaClose = this.matVecMul(XtXInv, XtYClose);
      this.weightsClose = betaClose.slice(0, p);
      this.biasClose = betaClose[p];
    }
  }

  predictHigh(x: number[]): number {
    const xStd = x.map((v, j) => (v - this.featureMeans[j]) / this.featureStds[j]);
    let pred = this.biasHigh;
    for (let j = 0; j < xStd.length; j++) {
      pred += this.weightsHigh[j] * xStd[j];
    }
    return pred;
  }

  predictLow(x: number[]): number {
    const xStd = x.map((v, j) => (v - this.featureMeans[j]) / this.featureStds[j]);
    let pred = this.biasLow;
    for (let j = 0; j < xStd.length; j++) {
      pred += this.weightsLow[j] * xStd[j];
    }
    return pred;
  }

  predictClose(x: number[]): number {
    // Fallback: if no close weights trained (old model), return midpoint of H/L
    if (this.weightsClose.length === 0) {
      return (this.predictHigh(x) + this.predictLow(x)) / 2;
    }
    const xStd = x.map((v, j) => (v - this.featureMeans[j]) / this.featureStds[j]);
    let pred = this.biasClose;
    for (let j = 0; j < xStd.length; j++) {
      pred += this.weightsClose[j] * xStd[j];
    }
    return pred;
  }

  serialize(): string {
    return JSON.stringify({
      type: "linear-regression",
      lambda: this.lambda,
      weightsHigh: this.weightsHigh,
      weightsLow: this.weightsLow,
      weightsClose: this.weightsClose,
      biasHigh: this.biasHigh,
      biasLow: this.biasLow,
      biasClose: this.biasClose,
      featureMeans: this.featureMeans,
      featureStds: this.featureStds,
    });
  }

  getHyperparameters(): Record<string, unknown> {
    return {
      method: "Ridge (L2)",
      lambda: this.lambda,
      regularization: "L2 + FeatureStandardization",
    };
  }

  static deserialize(json: string): LinearRegressionModel {
    const data = JSON.parse(json);
    const model = new LinearRegressionModel(data.lambda || 1.0);
    model.weightsHigh = data.weightsHigh || [];
    model.weightsLow = data.weightsLow || [];
    model.weightsClose = data.weightsClose || [];
    model.biasHigh = data.biasHigh || 0;
    model.biasLow = data.biasLow || 0;
    model.biasClose = data.biasClose || 0;
    model.featureMeans = data.featureMeans || [];
    model.featureStds = data.featureStds || [];
    return model;
  }

  // --- Linear algebra utilities ---

  private transpose(M: number[][]): number[][] {
    const rows = M.length;
    const cols = M[0].length;
    const T: number[][] = Array.from({ length: cols }, () => new Array(rows).fill(0));
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        T[j][i] = M[i][j];
      }
    }
    return T;
  }

  private matMul(A: number[][], B: number[][]): number[][] {
    const n = A.length;
    const m = B[0].length;
    const k = B.length;
    const C: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        for (let l = 0; l < k; l++) {
          C[i][j] += A[i][l] * B[l][j];
        }
      }
    }
    return C;
  }

  private matVecMul(M: number[][], v: number[]): number[] {
    return M.map((row) => row.reduce((s, val, j) => s + val * v[j], 0));
  }

  private invertMatrix(M: number[][]): number[][] | null {
    const n = M.length;
    // Augment with identity
    const aug: number[][] = M.map((row, i) => {
      const identity = new Array(n).fill(0);
      identity[i] = 1;
      return [...row, ...identity];
    });

    // Gauss-Jordan elimination
    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxVal = Math.abs(aug[i][i]);
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(aug[k][i]) > maxVal) {
          maxVal = Math.abs(aug[k][i]);
          maxRow = k;
        }
      }

      if (maxVal < 1e-12) return null; // singular

      // Swap rows
      [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];

      // Scale pivot row
      const pivot = aug[i][i];
      for (let j = 0; j < 2 * n; j++) {
        aug[i][j] /= pivot;
      }

      // Eliminate column
      for (let k = 0; k < n; k++) {
        if (k === i) continue;
        const factor = aug[k][i];
        for (let j = 0; j < 2 * n; j++) {
          aug[k][j] -= factor * aug[i][j];
        }
      }
    }

    // Extract inverse
    return aug.map((row) => row.slice(n));
  }
}
