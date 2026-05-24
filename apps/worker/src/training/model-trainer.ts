import { OHLCV } from "../types/market-data/ohlcv.ts";
import { FeatureVector, PreviousDayContext } from "../types/features/feature-vector.ts";
import FeatureEngineer from "../features/feature-engineer.ts";
import { TrainableModel, TrainingResult, ModelType } from "../training/models/trainable-model.ts";
import { LinearRegressionModel } from "../training/models/linear-regression-model.ts";
import { ModelMetrics } from "../types/models/model-metadata.ts";
import { HistoricalDataProvider } from "../data/providers/historical-data-provider.ts";
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
 * Model trainer orchestrator — fetches data from provider, computes features,
 * trains model, evaluates on validation set using walk-forward expanding window.
 *
 * Walk-forward validation:
 * - Data sorted chronologically
 * - Train on first N days, validate on next M days
 * - NO random splits (prevents future data leakage)
 */
export default class ModelTrainer {
  private featureEngineer: FeatureEngineer;
  private provider: HistoricalDataProvider;

  constructor(provider: HistoricalDataProvider) {
    this.featureEngineer = new FeatureEngineer();
    this.provider = provider;
  }

  /**
   * Train a model for a given symbol using historical data from the provider.
   *
   * @param symbol Stock symbol
   * @param securityId Paytm Money pmlId for the stock
   * @param fromDate Start date for training data (YYYY-MM-DD)
   * @param toDate End date for training data (YYYY-MM-DD)
   * @param modelType Algorithm to use
   * @param validationRatio Fraction of data for validation (default 0.2 = last 20%)
   * @returns TrainingResult or null if insufficient data
   */
  async train(
    symbol: string,
    securityId: string,
    fromDate: string,
    toDate: string,
    validationRatio: number = 0.2,
  ): Promise<TrainingResult | null> {
    const startTime = Date.now();

    // Step 1: Fetch historical data from provider
    logger.info(`Fetching ${symbol} data from ${fromDate} to ${toDate}...`);
    const allCandles = await this.provider.fetchOHLCV({
      symbol,
      securityId,
      exchange: "NSE",
      fromDate,
      toDate,
      interval: "MINUTE",
    });

    if (allCandles.length === 0) {
      logger.error(`No data returned for ${symbol}`);
      return null;
    }

    logger.info(`Fetched ${allCandles.length} candles for ${symbol}`);

    // Step 2: Group candles by day
    const samples = this.buildSamples(symbol, allCandles);

    if (samples.length < 30) {
      logger.error(`Insufficient data for ${symbol}: ${samples.length} days (need ≥30)`);
      return null;
    }

    logger.info(`Built ${samples.length} training samples for ${symbol}`);

    // Step 3: Walk-forward split (chronological)
    const splitIdx = Math.floor(samples.length * (1 - validationRatio));
    const trainSet = samples.slice(0, splitIdx);
    const valSet = samples.slice(splitIdx);

    logger.info(`Split: ${trainSet.length} train / ${valSet.length} validation`);

    // Step 4: Prepare feature matrices
    const X_train = trainSet.map((s) => s.featureArray);
    const yHigh_train = trainSet.map((s) => s.targetHigh);
    const yLow_train = trainSet.map((s) => s.targetLow);

    // Step 5: Train model
    const resolvedType: ModelType = "linear-regression";
    const model = this.createModel(resolvedType);
    logger.info(`Training ${resolvedType} model...`);
    model.fit(X_train, yHigh_train, yLow_train);

    // Step 6: Evaluate on validation set
    const metrics = this.evaluateModel(model, valSet);
    const durationMs = Date.now() - startTime;

    logger.info(`Training complete in ${durationMs}ms — MAE: ${metrics.mae.toFixed(2)}, MAPE: ${metrics.mape.toFixed(2)}%, Dir: ${metrics.directionalAccuracy.toFixed(1)}%, R²: ${metrics.r2.toFixed(3)}`);

    // Step 7: Build result
    return {
      modelType: resolvedType,
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
   * Build training samples from fetched candles.
   * Groups candles by day, computes features from first 45 min,
   * uses full day's high/low as targets.
   */
  private buildSamples(symbol: string, allCandles: OHLCV[]): TrainingSample[] {
    const samples: TrainingSample[] = [];

    // Group candles by date
    const byDate = new Map<string, OHLCV[]>();
    for (const candle of allCandles) {
      const date = candle.timestamp.split(" ")[0];
      const existing = byDate.get(date) || [];
      existing.push(candle);
      byDate.set(date, existing);
    }

    // Sort dates chronologically
    const dates = [...byDate.keys()].sort();
    let prevDayContext: PreviousDayContext | null = null;

    for (const date of dates) {
      const candles = byDate.get(date)!;

      if (candles.length < 60) {
        prevDayContext = this.buildPrevDayContext(candles, prevDayContext);
        continue;
      }

      // Compute features from data up to 11:00 AM (first 105 min)
      const features = this.featureEngineer.compute(symbol, date, candles, prevDayContext);
      if (!features) {
        prevDayContext = this.buildPrevDayContext(candles, prevDayContext);
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

      prevDayContext = this.buildPrevDayContext(candles, prevDayContext);
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

      // Directional accuracy: did the model correctly predict whether
      // today's midpoint (avg of high/low) would be above or below prev close?
      const predMid = (predHigh + predLow) / 2;
      const actualMid = (sample.targetHigh + sample.targetLow) / 2;
      const prevClose = sample.features.prevClose1;
      if (prevClose > 0) {
        const predDirection = predMid > prevClose; // model predicts bullish day
        const actualDirection = actualMid > prevClose; // day was actually bullish
        if (predDirection === actualDirection) {
          directionalCorrect++;
        }
      }

      // Range containment: does predicted range fully contain actual range?
      if (sample.targetHigh <= predHigh && sample.targetLow >= predLow) {
        rangeContained++;
      }
    }

    const n = valSet.length;
    const mae = (totalHighErr + totalLowErr) / (2 * n);
    const rmse = Math.sqrt((totalHighSqErr + totalLowSqErr) / (2 * n));
    const mape = (totalHighPctErr + totalLowPctErr) / (2 * n);

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

  private buildPrevDayContext(candles: OHLCV[], prevContext: PreviousDayContext | null): PreviousDayContext {
    const close = candles.length > 0 ? candles[candles.length - 1].close : 0;
    const high = candles.length > 0 ? Math.max(...candles.map((c) => c.high)) : 0;
    const first105 = candles.slice(0, 105);
    const avg45MinVolume = first105.reduce((s, c) => s + c.volume, 0);
    return {
      close,
      high,
      avg45MinVolume,
      // Shift previous days down: D-1 becomes D-2, D-2 becomes D-3
      close2: prevContext?.close ?? null,
      high2: prevContext?.high ?? null,
      close3: prevContext?.close2 ?? null,
      high3: prevContext?.high2 ?? null,
    };
  }

  private createModel(_modelType: ModelType): TrainableModel {
    return new LinearRegressionModel();
  }

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
