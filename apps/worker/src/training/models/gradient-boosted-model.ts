import { DecisionTreeRegression } from "ml-cart";
import { TrainableModel } from "./trainable-model.ts";

/**
 * Gradient Boosted Trees regression model using ml-cart.
 * Manual gradient boosting implementation with DecisionTree stumps.
 * Trains separate boosted ensembles for HIGH and LOW prediction.
 *
 * Anti-overfitting:
 * - Early stopping (monitors validation OOB error, stops when no improvement)
 * - Stochastic subsampling (only 80% of data per tree)
 * - Shrinkage via learning rate (0.05 default)
 * - Max depth limit (3 default — shallow trees)
 * - Min samples per leaf
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
  private readonly earlyStopRounds: number;
  private readonly minSamplesLeaf: number;
  private actualEstimatorsUsed: number = 0;

  constructor(
    nEstimators: number = 200,
    learningRate: number = 0.05,
    maxDepth: number = 3,
    subsampleRatio: number = 0.8,
    earlyStopRounds: number = 20,
    minSamplesLeaf: number = 5,
  ) {
    this.nEstimators = nEstimators;
    this.learningRate = learningRate;
    this.maxDepth = maxDepth;
    this.subsampleRatio = subsampleRatio;
    this.earlyStopRounds = earlyStopRounds;
    this.minSamplesLeaf = minSamplesLeaf;
  }

  fit(X: number[][], yHigh: number[], yLow: number[]): void {
    this.treesHigh = [];
    this.treesLow = [];

    // Split into train (80%) and validation (20%) for early stopping
    const valSize = Math.floor(X.length * 0.2);
    const trainSize = X.length - valSize;
    const X_train = X.slice(0, trainSize);
    const X_val = X.slice(trainSize);
    const yHigh_train = yHigh.slice(0, trainSize);
    const yHigh_val = yHigh.slice(trainSize);
    const yLow_train = yLow.slice(0, trainSize);
    const yLow_val = yLow.slice(trainSize);

    // Initialize with mean (base prediction)
    this.baseHigh = yHigh_train.reduce((s, v) => s + v, 0) / yHigh_train.length;
    this.baseLow = yLow_train.reduce((s, v) => s + v, 0) / yLow_train.length;

    let residualsHigh = yHigh_train.map((y) => y - this.baseHigh);
    let residualsLow = yLow_train.map((y) => y - this.baseLow);

    let bestValError = Infinity;
    let roundsWithoutImprovement = 0;

    for (let i = 0; i < this.nEstimators; i++) {
      // Subsample for stochastic gradient boosting
      const { X: Xs, y: rH } = this.subsample(X_train, residualsHigh);
      const { y: rL } = this.subsample(X_train, residualsLow);

      // Fit tree on residuals
      const treeHigh = new DecisionTreeRegression({
        maxDepth: this.maxDepth,
        minNumSamples: this.minSamplesLeaf,
      });
      treeHigh.train(Xs, rH);
      this.treesHigh.push(treeHigh);

      const treeLow = new DecisionTreeRegression({
        maxDepth: this.maxDepth,
        minNumSamples: this.minSamplesLeaf,
      });
      treeLow.train(Xs, rL);
      this.treesLow.push(treeLow);

      // Update training residuals
      const predsH = treeHigh.predict(X_train) as number[];
      const predsL = treeLow.predict(X_train) as number[];
      residualsHigh = residualsHigh.map((r, j) => r - this.learningRate * predsH[j]);
      residualsLow = residualsLow.map((r, j) => r - this.learningRate * predsL[j]);

      // Early stopping: evaluate on validation set
      if (X_val.length > 0) {
        let valError = 0;
        for (let v = 0; v < X_val.length; v++) {
          const predH = this.predictHigh(X_val[v]);
          const predL = this.predictLow(X_val[v]);
          valError += Math.abs(predH - yHigh_val[v]) + Math.abs(predL - yLow_val[v]);
        }
        valError /= (2 * X_val.length);

        if (valError < bestValError) {
          bestValError = valError;
          roundsWithoutImprovement = 0;
        } else {
          roundsWithoutImprovement++;
          if (roundsWithoutImprovement >= this.earlyStopRounds) {
            // Remove last trees that didn't help
            this.treesHigh.pop();
            this.treesLow.pop();
            break;
          }
        }
      }
    }

    this.actualEstimatorsUsed = this.treesHigh.length;
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
      actualEstimatorsUsed: this.actualEstimatorsUsed,
      learningRate: this.learningRate,
      maxDepth: this.maxDepth,
      subsampleRatio: this.subsampleRatio,
      earlyStopRounds: this.earlyStopRounds,
      minSamplesLeaf: this.minSamplesLeaf,
      algorithm: "gradient-boosted-trees",
      library: "ml-cart",
      regularization: "EarlyStopping + Shrinkage + Subsampling + ShallowTrees",
    };
  }

  static deserialize(json: string): GradientBoostedModel {
    const data = JSON.parse(json);
    const model = new GradientBoostedModel(
      data.nEstimators, data.learningRate, data.maxDepth, data.subsampleRatio,
      data.earlyStopRounds, data.minSamplesLeaf,
    );
    model.baseHigh = data.baseHigh;
    model.baseLow = data.baseLow;
    model.treesHigh = data.treesHigh.map((t: any) => DecisionTreeRegression.load(t));
    model.treesLow = data.treesLow.map((t: any) => DecisionTreeRegression.load(t));
    return model;
  }
}
