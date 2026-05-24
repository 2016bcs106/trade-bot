import { RandomForestRegression } from "ml-random-forest";
import { TrainableModel } from "./trainable-model.ts";

/**
 * Random forest regression model using ml-random-forest.
 * Trains separate forests for HIGH and LOW prediction.
 */
export class RandomForestModel implements TrainableModel {
  private forestHigh: RandomForestRegression | null = null;
  private forestLow: RandomForestRegression | null = null;

  private readonly nEstimators: number;
  private readonly maxDepth: number;
  private readonly minSamplesLeaf: number;
  private readonly maxFeatures: number;

  constructor(
    nEstimators: number = 50,
    maxDepth: number = 10,
    minSamplesLeaf: number = 3,
    maxFeatures: number = 0.7,
  ) {
    this.nEstimators = nEstimators;
    this.maxDepth = maxDepth;
    this.minSamplesLeaf = minSamplesLeaf;
    this.maxFeatures = maxFeatures;
  }

  fit(X: number[][], yHigh: number[], yLow: number[]): void {
    const options = {
      nEstimators: this.nEstimators,
      seed: 42,
      useSampleBagging: true,
      treeOptions: {
        maxDepth: this.maxDepth,
        minNumSamples: this.minSamplesLeaf,
      },
    };

    this.forestHigh = new RandomForestRegression(options);
    this.forestHigh.train(X, yHigh);

    this.forestLow = new RandomForestRegression(options);
    this.forestLow.train(X, yLow);
  }

  predictHigh(x: number[]): number {
    if (!this.forestHigh) return 0;
    return this.forestHigh.predict([x])[0];
  }

  predictLow(x: number[]): number {
    if (!this.forestLow) return 0;
    return this.forestLow.predict([x])[0];
  }

  serialize(): string {
    return JSON.stringify({
      type: "random-forest",
      nEstimators: this.nEstimators,
      maxDepth: this.maxDepth,
      minSamplesLeaf: this.minSamplesLeaf,
      maxFeatures: this.maxFeatures,
      forestHigh: this.forestHigh?.toJSON() ?? null,
      forestLow: this.forestLow?.toJSON() ?? null,
    });
  }

  getHyperparameters(): Record<string, unknown> {
    return {
      nEstimators: this.nEstimators,
      maxDepth: this.maxDepth,
      minSamplesLeaf: this.minSamplesLeaf,
      maxFeatures: this.maxFeatures,
      library: "ml-random-forest",
    };
  }

  static deserialize(json: string): RandomForestModel {
    const data = JSON.parse(json);
    const model = new RandomForestModel(
      data.nEstimators,
      data.maxDepth,
      data.minSamplesLeaf,
      data.maxFeatures,
    );
    if (data.forestHigh) {
      model.forestHigh = RandomForestRegression.load(data.forestHigh);
    }
    if (data.forestLow) {
      model.forestLow = RandomForestRegression.load(data.forestLow);
    }
    return model;
  }
}
