import { FeatureVector } from "../types/features/feature-vector.ts";
import { ModelMetrics, TrainingInfo } from "../types/models/model-metadata.ts";
import FeatureEngineer from "../features/feature-engineer.ts";
import { LinearRegressionModel } from "./models/linear-regression-model.ts";
import { RandomForestModel } from "./models/random-forest-model.ts";
import { TrainableModel, TrainingResult } from "./models/trainable-model.ts";

/**
 * Model training pipeline with walk-forward validation.
 *
 * Key principles:
 * - NEVER uses random train/test split (chronological only)
 * - Expanding window: train on all data up to point T, validate on T+1...T+N
 * - Trains separate models for HIGH and LOW prediction
 */
export default class ModelTrainer {
  private featureEngineer: FeatureEngineer;

  constructor() {
    this.featureEngineer = new FeatureEngineer();
  }

  /**
   * Train a model using walk-forward validation.
   *
   * @param symbol Stock symbol
   * @param features Chronologically ordered feature vectors (with actualHigh/Low filled)
   * @param modelType Which model algorithm to use
   * @param validationRatio Fraction of data to use for validation (from the end)
   * @returns Training result with model metadata and serialized weights
   */
  train(
    symbol: string,
    features: FeatureVector[],
    modelType: "linear-regression" | "random-forest",
    validationRatio: number = 0.2,
  ): TrainingResult | null {
    // Filter to only samples with targets
    const validSamples = features.filter((f) => f.actualHigh !== undefined && f.actualLow !== undefined);

    if (validSamples.length < 30) {
      return null; // Insufficient data
    }

    // Chronological split (NO random shuffle)
    const splitIndex = Math.floor(validSamples.length * (1 - validationRatio));
    const trainSet = validSamples.slice(0, splitIndex);
    const valSet = validSamples.slice(splitIndex);

    if (trainSet.length < 20 || valSet.length < 5) {
      return null;
    }

    // Convert to numeric arrays
    const trainX = trainSet.map((f) => this.featureEngineer.toNumericArray(f));
    const trainYHigh = trainSet.map((f) => f.actualHigh!);
    const trainYLow = trainSet.map((f) => f.actualLow!);

    const valX = valSet.map((f) => this.featureEngineer.toNumericArray(f));
    const valYHigh = valSet.map((f) => f.actualHigh!);
    const valYLow = valSet.map((f) => f.actualLow!);

    // Create model
    const startTime = Date.now();
    const model = this.createModel(modelType);

    // Train on combined high/low targets
    model.fit(trainX, trainYHigh, trainYLow);

    const durationMs = Date.now() - startTime;

    // Validate
    const predictionsHigh = valX.map((x) => model.predictHigh(x));
    const predictionsLow = valX.map((x) => model.predictLow(x));

    // Compute metrics
    const metrics = this.computeMetrics(
      predictionsHigh,
      predictionsLow,
      valYHigh,
      valYLow,
      valSet,
    );

    // Build training info
    const trainingInfo: TrainingInfo = {
      dataStartDate: validSamples[0].date,
      dataEndDate: validSamples[validSamples.length - 1].date,
      sampleCount: trainSet.length,
      featureCount: this.featureEngineer.getFeatureNames().length,
      features: this.featureEngineer.getFeatureNames(),
      hyperparameters: model.getHyperparameters(),
      durationMs,
    };

    return {
      modelType,
      symbol,
      serializedModel: model.serialize(),
      training: trainingInfo,
      metrics,
    };
  }

  /**
   * Compute validation metrics from predictions vs actuals.
   */
  private computeMetrics(
    predHigh: number[],
    predLow: number[],
    actualHigh: number[],
    actualLow: number[],
    valSet: FeatureVector[],
  ): ModelMetrics {
    const n = predHigh.length;

    // MAE
    let sumAbsErrorHigh = 0;
    let sumAbsErrorLow = 0;
    let sumSqErrorHigh = 0;
    let sumSqErrorLow = 0;
    let sumPctErrorHigh = 0;
    let sumPctErrorLow = 0;
    let directionalCorrect = 0;
    let rangeContained = 0;

    for (let i = 0; i < n; i++) {
      const errH = Math.abs(predHigh[i] - actualHigh[i]);
      const errL = Math.abs(predLow[i] - actualLow[i]);

      sumAbsErrorHigh += errH;
      sumAbsErrorLow += errL;
      sumSqErrorHigh += errH * errH;
      sumSqErrorLow += errL * errL;

      if (actualHigh[i] > 0) sumPctErrorHigh += errH / actualHigh[i];
      if (actualLow[i] > 0) sumPctErrorLow += errL / actualLow[i];

      // Directional accuracy: predicted range vs actual range direction
      const predMid = (predHigh[i] + predLow[i]) / 2;
      const actualMid = (actualHigh[i] + actualLow[i]) / 2;
      const cumReturn = valSet[i].cumulativeReturn;
      // If cumReturn is positive and predicted mid > actual low, or negative and below high
      if ((cumReturn >= 0 && predMid >= actualMid * 0.99) || (cumReturn < 0 && predMid <= actualMid * 1.01)) {
        directionalCorrect++;
      }

      // Range containment: actual high <= predicted high AND actual low >= predicted low
      if (actualHigh[i] <= predHigh[i] && actualLow[i] >= predLow[i]) {
        rangeContained++;
      }
    }

    const mae = (sumAbsErrorHigh + sumAbsErrorLow) / (2 * n);
    const rmse = Math.sqrt((sumSqErrorHigh + sumSqErrorLow) / (2 * n));
    const mape = ((sumPctErrorHigh + sumPctErrorLow) / (2 * n)) * 100;

    // R-squared (for high prediction)
    const meanHigh = actualHigh.reduce((s, v) => s + v, 0) / n;
    const ssRes = actualHigh.reduce((s, v, i) => s + (v - predHigh[i]) ** 2, 0);
    const ssTot = actualHigh.reduce((s, v) => s + (v - meanHigh) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    return {
      mae,
      rmse,
      mape,
      directionalAccuracy: (directionalCorrect / n) * 100,
      rangeContainment: (rangeContained / n) * 100,
      r2,
      validationSamples: n,
    };
  }

  private createModel(modelType: "linear-regression" | "random-forest"): TrainableModel {
    switch (modelType) {
      case "linear-regression":
        return new LinearRegressionModel();
      case "random-forest":
        return new RandomForestModel();
    }
  }
}
