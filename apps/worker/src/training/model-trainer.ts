import { OHLCV } from "../types/market-data/ohlcv.ts";
import { FeatureVector, PreviousDayContext } from "../types/features/feature-vector.ts";
import FeatureEngineer from "../features/feature-engineer.ts";
import { TrainableModel, SingleTrainResult, ModelType } from "../training/models/trainable-model.ts";
import { LinearRegressionModel } from "../training/models/linear-regression-model.ts";
import { ModelMetrics } from "../types/models/model-metadata.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";
import createLogger from "../utils/logger.ts";

const logger = createLogger("model-trainer");

/**
 * Training sample: feature vector + target labels.
 * v2: Targets are RETURNS from reference price, not absolute prices.
 */
interface TrainingSample {
  features: FeatureVector;
  featureArray: number[];
  targetHighReturn: number;   // (actualHigh - referencePrice) / referencePrice
  targetLowReturn: number;    // (actualLow - referencePrice) / referencePrice
  targetCloseReturn: number;  // (actualClose - referencePrice) / referencePrice
  referencePrice: number;     // Entry/reference price at prediction time
  targetHigh: number;         // Absolute high (for metrics computation)
  targetLow: number;          // Absolute low
  targetClose: number;        // Absolute close
  date: string;
}

/** Lambda values to search over for auto-calibration */
const LAMBDA_GRID = [0.1, 1.0, 5.0, 10.0, 50.0, 100.0, 500.0];

/**
 * Model trainer orchestrator — fetches data from provider, computes features,
 * trains model, evaluates on validation set using walk-forward expanding window.
 *
 * v2 Improvements:
 * - Returns-based targets (predicts % change, not absolute price)
 * - Auto-calibrating lambda via grid search on directional accuracy
 * - Feature importance logging
 *
 * Walk-forward validation:
 * - Data sorted chronologically
 * - Train on first N days, validate on next M days
 * - NO random splits (prevents future data leakage)
 */
export default class ModelTrainer {
  private featureEngineer: FeatureEngineer;
  private client: PaytmMoneyClient;

  constructor(client: PaytmMoneyClient) {
    this.featureEngineer = new FeatureEngineer();
    this.client = client;
  }

  /** Get the number of features used by the feature engineer. */
  getFeatureCount(): number {
    return this.featureEngineer.getFeatureNames().length;
  }

  /** Get the feature names used by the feature engineer. */
  getFeatureNames(): string[] {
    return this.featureEngineer.getFeatureNames();
  }

  /**
   * Train a model for a given symbol using historical data from the provider.
   * v2: Auto-calibrates lambda for best directional accuracy.
   */
  async train(
    symbol: string,
    securityId: string,
    fromDate: string,
    toDate: string,
    windowSize: number,
    validationRatio: number = 0.2,
  ): Promise<SingleTrainResult | null> {
    const startTime = Date.now();

    // Step 1: Fetch historical data
    logger.info(`Fetching ${symbol} data from ${fromDate} to ${toDate}...`);
    const allCandles = await this.client.fetchOHLCV(securityId, fromDate, toDate, "MINUTE");

    if (allCandles.length === 0) {
      logger.error(`No data returned for ${symbol}`);
      return null;
    }

    logger.info(`Fetched ${allCandles.length} candles for ${symbol}`);

    // Step 2: Group candles by day and build samples
    const samples = this.buildSamples(symbol, allCandles, windowSize);

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

    // Step 4: Auto-calibrate lambda via grid search
    const { bestModel, bestLambda, bestMetrics } = this.gridSearchLambda(trainSet, valSet);
    const durationMs = Date.now() - startTime;

    logger.info(`Training complete in ${durationMs}ms — Lambda: ${bestLambda}, MAE: ${bestMetrics.mae.toFixed(2)}, MAPE: ${bestMetrics.mape.toFixed(2)}%, Dir: ${bestMetrics.directionalAccuracy.toFixed(1)}%, R²: ${bestMetrics.r2.toFixed(3)}`);

    // Step 5: Log feature importance
    this.logFeatureImportance(bestModel);

    // Step 6: Build result
    return {
      modelType: "linear-regression" as ModelType,
      symbol,
      serializedModel: bestModel.serialize(),
      training: {
        dataStartDate: samples[0].date,
        dataEndDate: samples[samples.length - 1].date,
        sampleCount: trainSet.length,
        featureCount: this.featureEngineer.getFeatureNames().length,
        features: this.featureEngineer.getFeatureNames(),
        hyperparameters: bestModel.getHyperparameters(),
        durationMs,
        windowSize,
      },
      metrics: bestMetrics,
    };
  }

  /**
   * Grid search over lambda values to find optimal regularization.
   * Optimizes for directional accuracy (primary) with MAE as tiebreaker.
   */
  private gridSearchLambda(
    trainSet: TrainingSample[],
    valSet: TrainingSample[],
  ): { bestModel: TrainableModel; bestLambda: number; bestMetrics: ModelMetrics } {
    const X_train = trainSet.map((s) => s.featureArray);
    const yHighReturn_train = trainSet.map((s) => s.targetHighReturn);
    const yLowReturn_train = trainSet.map((s) => s.targetLowReturn);
    const yCloseReturn_train = trainSet.map((s) => s.targetCloseReturn);

    let bestModel: TrainableModel | null = null;
    let bestLambda = 1.0;
    let bestMetrics: ModelMetrics | null = null;
    let bestScore = -Infinity;

    for (const lambda of LAMBDA_GRID) {
      const model = new LinearRegressionModel(lambda);
      model.fit(X_train, yHighReturn_train, yLowReturn_train, yCloseReturn_train);

      const metrics = this.evaluateModel(model, valSet);

      // Score: prioritize directional accuracy, penalize high MAE
      const score = metrics.directionalAccuracy * 2 - metrics.mape;

      logger.info(`  Lambda=${lambda}: Dir=${metrics.directionalAccuracy.toFixed(1)}%, MAE=${metrics.mae.toFixed(2)}, Score=${score.toFixed(2)}`);

      if (score > bestScore) {
        bestScore = score;
        bestModel = model;
        bestLambda = lambda;
        bestMetrics = metrics;
      }
    }

    return {
      bestModel: bestModel!,
      bestLambda,
      bestMetrics: bestMetrics!,
    };
  }

  /**
   * Log top features by absolute weight magnitude.
   */
  private logFeatureImportance(model: TrainableModel): void {
    const hyperparams = model.getHyperparameters();
    const weightsClose = hyperparams.weightsClose as number[] | undefined;
    if (!weightsClose || weightsClose.length === 0) return;

    const featureNames = this.featureEngineer.getFeatureNames();
    const indexed = weightsClose.map((w, i) => ({ name: featureNames[i] || `f${i}`, weight: Math.abs(w) }));
    indexed.sort((a, b) => b.weight - a.weight);

    logger.info("  Top 10 features by |weight| (close model):");
    for (let i = 0; i < Math.min(10, indexed.length); i++) {
      logger.info(`    ${(i + 1).toString().padStart(2)}. ${indexed[i].name.padEnd(25)} ${indexed[i].weight.toFixed(6)}`);
    }
  }

  /**
   * Train horizon-specific models (every 5 min from 5 to 370) using pre-fetched candles.
   * v2: Uses returns-based targets and auto-calibration.
   */
  trainHorizons(
    symbol: string,
    allCandles: OHLCV[],
    horizons: number[],
  ): Array<{ horizon: number; serializedModel: string; metrics: ModelMetrics; windowSize: number }> {
    const results: Array<{ horizon: number; serializedModel: string; metrics: ModelMetrics; windowSize: number }> = [];

    for (const horizon of horizons) {
      const samples = this.buildSamples(symbol, allCandles, horizon);
      if (samples.length < 30) {
        logger.warn(`Horizon ${horizon}: only ${samples.length} samples (need ≥30), skipping`);
        continue;
      }

      const splitIdx = Math.floor(samples.length * 0.8);
      const trainSet = samples.slice(0, splitIdx);
      const valSet = samples.slice(splitIdx);

      // Auto-calibrate for each horizon
      const { bestModel, bestLambda, bestMetrics } = this.gridSearchLambda(trainSet, valSet);

      results.push({
        horizon,
        serializedModel: bestModel.serialize(),
        metrics: bestMetrics,
        windowSize: horizon,
      });

      logger.info(`  Horizon ${horizon}min: Lambda=${bestLambda}, MAE=${bestMetrics.mae.toFixed(2)}, Dir=${bestMetrics.directionalAccuracy.toFixed(1)}%`);
    }

    return results;
  }

  /**
   * Build training samples from fetched candles.
   * v2: Targets are returns from reference price (last candle in window).
   */
  private buildSamples(symbol: string, allCandles: OHLCV[], windowSize: number): TrainingSample[] {
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

      if (candles.length < windowSize) {
        prevDayContext = this.buildPrevDayContext(candles, prevDayContext);
        continue;
      }

      // Compute features from the specified window
      const features = this.featureEngineer.compute(symbol, date, candles, prevDayContext, windowSize);
      if (!features) {
        prevDayContext = this.buildPrevDayContext(candles, prevDayContext);
        continue;
      }

      // Reference price: last candle close in window (same as prediction engine uses)
      const windowEnd = Math.min(windowSize, candles.length) - 1;
      const referencePrice = candles[windowEnd].close;

      if (referencePrice <= 0) {
        prevDayContext = this.buildPrevDayContext(candles, prevDayContext);
        continue;
      }

      // Target: actual daily high, low, and close from ALL candles
      const dailyHigh = Math.max(...candles.map((c) => c.high));
      const dailyLow = Math.min(...candles.map((c) => c.low));
      const dailyClose = candles[candles.length - 1].close;

      // v2: Convert targets to returns from reference price
      const targetHighReturn = (dailyHigh - referencePrice) / referencePrice;
      const targetLowReturn = (dailyLow - referencePrice) / referencePrice;
      const targetCloseReturn = (dailyClose - referencePrice) / referencePrice;

      samples.push({
        features,
        featureArray: this.featureEngineer.toNumericArray(features),
        targetHighReturn,
        targetLowReturn,
        targetCloseReturn,
        referencePrice,
        targetHigh: dailyHigh,
        targetLow: dailyLow,
        targetClose: dailyClose,
        date,
      });

      prevDayContext = this.buildPrevDayContext(candles, prevDayContext);
    }

    return samples;
  }

  /**
   * Evaluate model on validation samples, computing standard metrics.
   * v2: Model predicts returns, then we reconstruct absolute prices for metrics.
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
      // Model predicts returns
      const predHighReturn = model.predictHigh(sample.featureArray);
      const predLowReturn = model.predictLow(sample.featureArray);
      const predCloseReturn = model.predictClose(sample.featureArray);

      // Reconstruct absolute prices from returns
      const predHigh = sample.referencePrice * (1 + predHighReturn);
      const predLow = sample.referencePrice * (1 + predLowReturn);
      const predClose = sample.referencePrice * (1 + predCloseReturn);

      const highErr = Math.abs(predHigh - sample.targetHigh);
      const lowErr = Math.abs(predLow - sample.targetLow);

      totalHighErr += highErr;
      totalLowErr += lowErr;
      totalHighSqErr += highErr ** 2;
      totalLowSqErr += lowErr ** 2;
      totalHighPctErr += sample.targetHigh > 0 ? (highErr / sample.targetHigh) * 100 : 0;
      totalLowPctErr += sample.targetLow > 0 ? (lowErr / sample.targetLow) * 100 : 0;

      // Directional accuracy: predicted return sign matches actual return sign
      const predDirection = predCloseReturn >= 0; // model predicts bullish
      const actualDirection = sample.targetCloseReturn >= 0; // actually bullish
      if (predDirection === actualDirection) {
        directionalCorrect++;
      }

      // Range containment: does predicted range contain actual range?
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
      ...valSet.map((s) => s.referencePrice * (1 + model.predictHigh(s.featureArray))),
      ...valSet.map((s) => s.referencePrice * (1 + model.predictLow(s.featureArray))),
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
    const low = candles.length > 0 ? Math.min(...candles.map((c) => c.low)) : 0;
    const first105 = candles.slice(0, 105);
    const averageMinVolume = first105.reduce((s, c) => s + c.volume, 0);
    return {
      close,
      high,
      low,
      averageMinVolume,
      // Shift previous days down: D-1 becomes D-2, D-2 becomes D-3
      close2: prevContext?.close ?? null,
      high2: prevContext?.high ?? null,
      low2: prevContext?.low ?? null,
      close3: prevContext?.close2 ?? null,
      high3: prevContext?.high2 ?? null,
      low3: prevContext?.low2 ?? null,
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
