import { DecisionTreeRegression } from "ml-cart";
import { TrainableModel } from "./trainable-model.ts";

/**
 * Gradient Boosted Trees regression model using ml-cart.
 * Manual gradient boosting implementation with DecisionTree stumps.
 * Trains separate boosted ensembles for HIGH and LOW prediction.
 */
export class GradientBoostedModel implements TrainableModel {
  private treesHigh: DecisionTreeRegression[] = [];
  private treesLow: DecisionTreeRegression[] = [];
  private baseHigh: number = 0;
  private baseLow: number = 0;

  private readonly nEstimators: number;
  private readonly learningRate: number;
  private readonly maxDepth: number;
  private readonly subsampleRatio: number;

  constructor(
    nEstimators: number = 100,
    learningRate: number = 0.1,
    maxDepth: number = 4,
    subsampleRatio: number = 0.8,
  ) {
    this.nEstimators = nEstimators;
    this.learningRate = learningRate;
    this.maxDepth = maxDepth;
    this.subsampleRatio = subsampleRatio;
  }

  fit(X: number[][], yHigh: number[], yLow: number[]): void {
    this.treesHigh = [];
    this.treesLow = [];

    // Initialize with mean (base prediction)
    this.baseHigh = yHigh.reduce((s, v) => s + v, 0) / yHigh.length;
    this.baseLow = yLow.reduce((s, v) => s + v, 0) / yLow.length;

    let residualsHigh = yHigh.map((y) => y - this.baseHigh);
    let residualsLow = yLow.map((y) => y - this.baseLow);

    for (let i = 0; i < this.nEstimators; i++) {
      // Subsample for stochastic gradient boosting
      const { X: Xs, y: rH } = this.subsample(X, residualsHigh);
      const { y: rL } = this.subsample(X, residualsLow);

      // Fit tree on residuals
      const treeHigh = new DecisionTreeRegression({ maxDepth: this.maxDepth });
      treeHigh.train(Xs, rH);
      this.treesHigh.push(treeHigh);

      const treeLow = new DecisionTreeRegression({ maxDepth: this.maxDepth });
      treeLow.train(Xs, rL);
      this.treesLow.push(treeLow);

      // Update residuals
      const predsH = treeHigh.predict(X) as number[];
      const predsL = treeLow.predict(X) as number[];
      residualsHigh = residualsHigh.map((r, j) => r - this.learningRate * predsH[j]);
      residualsLow = residualsLow.map((r, j) => r - this.learningRate * predsL[j]);
    }
  }

  predictHigh(x: number[]): number {
    let pred = this.baseHigh;
    for (const tree of this.treesHigh) {
      pred += this.learningRate * (tree.predict([x]) as number[])[0];
    }
    return pred;
  }

  predictLow(x: number[]): number {
    let pred = this.baseLow;
    for (const tree of this.treesLow) {
      pred += this.learningRate * (tree.predict([x]) as number[])[0];
    }
    return pred;
  }

  private subsample(X: number[][], y: number[]): { X: number[][]; y: number[] } {
    const n = Math.floor(X.length * this.subsampleRatio);
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      indices.push(Math.floor(Math.random() * X.length));
    }
    return {
      X: indices.map((i) => X[i]),
      y: indices.map((i) => y[i]),
    };
  }

  serialize(): string {
    return JSON.stringify({
      type: "gradient-boosted",
      nEstimators: this.nEstimators,
      learningRate: this.learningRate,
      maxDepth: this.maxDepth,
      subsampleRatio: this.subsampleRatio,
      baseHigh: this.baseHigh,
      baseLow: this.baseLow,
      treesHigh: this.treesHigh.map((t) => t.toJSON()),
      treesLow: this.treesLow.map((t) => t.toJSON()),
    });
  }

  getHyperparameters(): Record<string, unknown> {
    return {
      nEstimators: this.nEstimators,
      learningRate: this.learningRate,
      maxDepth: this.maxDepth,
      subsampleRatio: this.subsampleRatio,
      algorithm: "gradient-boosted-trees",
      library: "ml-cart",
    };
  }

  static deserialize(json: string): GradientBoostedModel {
    const data = JSON.parse(json);
    const model = new GradientBoostedModel(
      data.nEstimators, data.learningRate, data.maxDepth, data.subsampleRatio,
    );
    model.baseHigh = data.baseHigh;
    model.baseLow = data.baseLow;
    model.treesHigh = data.treesHigh.map((t: any) => DecisionTreeRegression.load(t));
    model.treesLow = data.treesLow.map((t: any) => DecisionTreeRegression.load(t));
    return model;
  }
}
