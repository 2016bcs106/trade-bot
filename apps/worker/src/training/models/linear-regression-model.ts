import MultivariateLinearRegression from "ml-regression-multivariate-linear";
import { TrainableModel } from "./trainable-model.ts";

/**
 * Multivariate linear regression model using ml-regression-multivariate-linear.
 * Trains separate models for HIGH and LOW prediction.
 */
export class LinearRegressionModel implements TrainableModel {
  private modelHigh: MultivariateLinearRegression | null = null;
  private modelLow: MultivariateLinearRegression | null = null;

  fit(X: number[][], yHigh: number[], yLow: number[]): void {
    // ml-regression expects y as column vectors (array of [value])
    this.modelHigh = new MultivariateLinearRegression(X, yHigh.map((v) => [v]));
    this.modelLow = new MultivariateLinearRegression(X, yLow.map((v) => [v]));
  }

  predictHigh(x: number[]): number {
    if (!this.modelHigh) return 0;
    const result = this.modelHigh.predict(x);
    return result[0];
  }

  predictLow(x: number[]): number {
    if (!this.modelLow) return 0;
    const result = this.modelLow.predict(x);
    return result[0];
  }

  serialize(): string {
    return JSON.stringify({
      type: "linear-regression",
      modelHigh: this.modelHigh?.toJSON() ?? null,
      modelLow: this.modelLow?.toJSON() ?? null,
    });
  }

  getHyperparameters(): Record<string, unknown> {
    return {
      method: "OLS",
      library: "ml-regression-multivariate-linear",
    };
  }

  static deserialize(json: string): LinearRegressionModel {
    const data = JSON.parse(json);
    const model = new LinearRegressionModel();
    if (data.modelHigh) {
      model.modelHigh = MultivariateLinearRegression.load(data.modelHigh);
    }
    if (data.modelLow) {
      model.modelLow = MultivariateLinearRegression.load(data.modelLow);
    }
    return model;
  }
}
