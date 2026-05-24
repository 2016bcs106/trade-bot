import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OHLCV } from "../types/market-data/ohlcv.ts";
import { FeatureVector, PreviousDayContext } from "../types/features/feature-vector.ts";
import FeatureEngineer from "../features/feature-engineer.ts";
import { TrainableModel, TrainingResult } from "../training/models/trainable-model.ts";
import { LinearRegressionModel } from "../training/models/linear-regression-model.ts";
import { RandomForestModel } from "../training/models/random-forest-model.ts";
import { ModelMetrics } from "../types/models/model-metadata.ts";
import NdjsonStorage from "../data/storage/ndjson-storage.ts";
import createLogger from "../utils/logger.ts";

const logger = createLogger("model-trainer");

/**
 * Training sample: feature vector + target labels (actual daily high/low).
 */
interface TrainingSample {
  features: FeatureVector;
  featureArray: number[];
  targetHigh: number;
  targetLow: number;
  date: string;
}

/**
 * Model trainer orchestrator — loads data, computes features, trains model,
 * evaluates on validation set using walk-forward expanding window.
 *
 * Walk-forward validation:
 * - Data sorted chronologically
 * - Train on first N days, validate on next M days
 * - NO random splits (prevents future data leakage)
 */
export default class ModelTrainer {
  private featureEngineer: FeatureEngineer;
  private storage: NdjsonStorage;

  constructor(dataDir?: string) {
    this.featureEngineer = new FeatureEngineer();
    this.storage = new NdjsonStorage(dataDir);
  }

  /**
   * Train a model for a given symbol using available historical 1-min data.
   *
   * @param symbol Stock symbol
   * @param modelType Algorithm to use
   * @param validationRatio Fraction of data for validation (default 0.2 = last 20%)
   * @returns TrainingResult or null if insufficient data
   */
  train(
    symbol: string,
    modelType: "linear-regression" | "random-forest" = "linear-regression",
    validationRatio: number = 0.2,
  ): TrainingResult | null {
    const startTime = Date.now();

    // Step 1: Load and prepare training samples
    logger.info(`Loading data for ${symbol}...`);
    const samples = this.buildSamples(symbol);

    if (samples.length < 30) {
      logger.error(`Insufficient data for ${symbol}: ${samples.length} samples (need ≥30)`);
      return null;
    }

    logger.info(`Built ${samples.length} training samples for ${symbol}`);

    // Step 2: Walk-forward split (chronological)
    const splitIdx = Math.floor(samples.length * (1 - validationRatio));
    const trainSet = samples.slice(0, splitIdx);
    const valSet = samples.slice(splitIdx);

    logger.info(`Split: ${trainSet.length} train / ${valSet.length} validation`);

    // Step 3: Prepare feature matrices
    const X_train = trainSet.map((s) => s.featureArray);
    const yHigh_train = trainSet.map((s) => s.targetHigh);
    const yLow_train = trainSet.map((s) => s.targetLow);

    // Step 4: Create and fit model
    const model = this.createModel(modelType);
    logger.info(`Training ${modelType} model...`);
    model.fit(X_train, yHigh_train, yLow_train);

    // Step 5: Evaluate on validation set
    const metrics = this.evaluateModel(model, valSet);
    const durationMs = Date.now() - startTime;

    logger.info(`Training complete in ${durationMs}ms — MAE: ${metrics.mae.toFixed(2)}, MAPE: ${metrics.mape.toFixed(2)}%`);

    // Step 6: Build result
    return {
      modelType,
      symbol,
      serializedModel: model.serialize(),
      training: {
        dataStartDate: samples[0].date,
        dataEndDate: samples[samples.length - 1].date,
        sampleCount: trainSet.length,
        featureCount: this.featureEngineer.getFeatureNames().length,
        features: this.featureEngineer.getFeatureNames(),
        hyperparameters: model.getHyperparameters(),
        durationMs,
      },
      metrics,
    };
  }

  /**
   * Build training samples from local ndjson data.
   * Each sample = features from first 45 min + targets from full day.
   */
  private buildSamples(symbol: string): TrainingSample[] {
    const samples: TrainingSample[] = [];

    // Get available dates by reading the data directory
    const dates = this.getAvailableDates(symbol, "1min");

    if (dates.length < 2) return samples;

    let prevDayContext: PreviousDayContext | null = null;

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const candles = this.storage.read(symbol, "1min", date);

      if (candles.length < 30) {
        // Update prevDay for next iteration regardless
        prevDayContext = this.buildPrevDayContext(candles);
        continue;
      }

      // Compute features from first 45 min
      const features = this.featureEngineer.compute(symbol, date, candles, prevDayContext);
      if (!features) {
        prevDayContext = this.buildPrevDayContext(candles);
        continue;
      }

      // Target: actual daily high and low from ALL candles
      const dailyHigh = Math.max(...candles.map((c) => c.high));
      const dailyLow = Math.min(...candles.map((c) => c.low));

      samples.push({
        features,
        featureArray: this.featureEngineer.toNumericArray(features),
        targetHigh: dailyHigh,
        targetLow: dailyLow,
        date,
      });

      // Update previous day context for next day
      prevDayContext = this.buildPrevDayContext(candles);
    }

    return samples;
  }

  /**
   * Evaluate model on validation samples, computing standard metrics.
   */
  private evaluateModel(model: TrainableModel, valSet: TrainingSample[]): ModelMetrics {
    let totalHighErr = 0;
    let totalLowErr = 0;
    let totalHighSqErr = 0;
    let totalLowSqErr = 0;
    let totalHighPctErr = 0;
    let totalLowPctErr = 0;
    let directionalCorrect = 0;
    let rangeContained = 0;

    for (const sample of valSet) {
      const predHigh = model.predictHigh(sample.featureArray);
      const predLow = model.predictLow(sample.featureArray);

      const highErr = Math.abs(predHigh - sample.targetHigh);
      const lowErr = Math.abs(predLow - sample.targetLow);

      totalHighErr += highErr;
      totalLowErr += lowErr;
      totalHighSqErr += highErr ** 2;
      totalLowSqErr += lowErr ** 2;
      totalHighPctErr += sample.targetHigh > 0 ? (highErr / sample.targetHigh) * 100 : 0;
      totalLowPctErr += sample.targetLow > 0 ? (lowErr / sample.targetLow) * 100 : 0;

      // Directional: predicted midpoint direction
      const predMid = (predHigh + predLow) / 2;
      const actualMid = (sample.targetHigh + sample.targetLow) / 2;
      const firstOpen = sample.features.cumulativeReturn; // relative to open
      if ((predMid > actualMid) === (firstOpen > 0)) {
        directionalCorrect++;
      }

      // Range containment
      if (sample.targetHigh <= predHigh && sample.targetLow >= predLow) {
        rangeContained++;
      }
    }

    const n = valSet.length;
    const mae = (totalHighErr + totalLowErr) / (2 * n);
    const rmse = Math.sqrt((totalHighSqErr + totalLowSqErr) / (2 * n));
    const mape = (totalHighPctErr + totalLowPctErr) / (2 * n);

    // R² computation (using combined high+low)
    const allActuals = [...valSet.map((s) => s.targetHigh), ...valSet.map((s) => s.targetLow)];
    const allPreds = [
      ...valSet.map((s) => model.predictHigh(s.featureArray)),
      ...valSet.map((s) => model.predictLow(s.featureArray)),
    ];
    const r2 = this.computeR2(allActuals, allPreds);

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

  /**
   * Build previous day context for feature engineering.
   */
  private buildPrevDayContext(candles: OHLCV[]): PreviousDayContext | null {
    if (candles.length === 0) return null;

    const close = candles[candles.length - 1].close;
    const first45 = candles.slice(0, 45);
    const avg45MinVolume = first45.length > 0
      ? first45.reduce((s, c) => s + c.volume, 0)
      : 0;

    return { close, avg45MinVolume };
  }

  /**
   * Get available dates with data for a symbol+interval, sorted chronologically.
   */
  private getAvailableDates(symbol: string, interval: string): string[] {
    const dir = join((this.storage as any).baseDir, symbol, interval);
    if (!existsSync(dir)) return [];

    return readdirSync(dir)
      .filter((f) => f.endsWith(".ndjson"))
      .map((f) => f.replace(".ndjson", ""))
      .sort();
  }

  /**
   * Create a model instance by type.
   */
  private createModel(modelType: "linear-regression" | "random-forest"): TrainableModel {
    switch (modelType) {
      case "linear-regression":
        return new LinearRegressionModel();
      case "random-forest":
        return new RandomForestModel();
    }
  }

  /**
   * Compute R² (coefficient of determination).
   */
  private computeR2(actuals: number[], predictions: number[]): number {
    const n = actuals.length;
    if (n === 0) return 0;

    const meanActual = actuals.reduce((s, v) => s + v, 0) / n;
    const ssRes = actuals.reduce((s, v, i) => s + (v - predictions[i]) ** 2, 0);
    const ssTot = actuals.reduce((s, v) => s + (v - meanActual) ** 2, 0);

    if (ssTot === 0) return 0;
    return 1 - ssRes / ssTot;
  }
}
