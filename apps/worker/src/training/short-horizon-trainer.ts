import { OHLCV } from "../types/market-data/ohlcv.ts";
import ShortHorizonFeatures from "../features/short-horizon-features.ts";
import { LinearRegressionModel } from "./models/linear-regression-model.ts";
import createLogger from "../utils/logger.ts";

const logger = createLogger("short-horizon-trainer");

/** Lambda grid for auto-calibration */
const LAMBDA_GRID = [0.01, 0.1, 1.0, 5.0, 10.0, 50.0, 100.0];

/** How many minutes ahead we predict */
const FORECAST_HORIZON = 5;

/** Minimum training samples required */
const MIN_SAMPLES = 100;

export interface ShortHorizonTrainResult {
  serializedModel: string;
  lambda: number;
  metrics: {
    mae: number;
    rmse: number;
    directionalAccuracy: number;
    meanReturn: number;
    sampleCount: number;
    validationSamples: number;
  };
  featureNames: string[];
  featureCount: number;
}

/**
 * Trainer for the short-horizon (5-min ahead) price prediction model.
 *
 * Training approach:
 * - Takes all historical 1-min candles for a symbol
 * - For each day, generates samples: at each minute T (from 9:45 to 15:20):
 *   - Input: features from candles [T-29, T-28, ..., T] (30-candle window)
 *   - Target: return = (close[T+5] - close[T]) / close[T]
 * - Walk-forward split: 80% train, 20% validation (chronological)
 * - Grid search lambda for best directional accuracy
 */
export default class ShortHorizonTrainer {
  private featureEngineer: ShortHorizonFeatures;

  constructor() {
    this.featureEngineer = new ShortHorizonFeatures();
  }

  /**
   * Train a short-horizon model from historical candle data.
   * @param symbol Stock symbol (for logging)
   * @param allCandles All 1-min historical candles (multi-day)
   * @returns Training result or null if insufficient data
   */
  train(symbol: string, allCandles: OHLCV[]): ShortHorizonTrainResult | null {
    const startTime = Date.now();

    // Step 1: Build training samples from all candles
    const samples = this.buildSamples(allCandles);

    if (samples.length < MIN_SAMPLES) {
      logger.warn(`${symbol}: only ${samples.length} short-horizon samples (need ≥${MIN_SAMPLES}), skipping`);
      return null;
    }

    logger.info(`${symbol}: built ${samples.length} short-horizon training samples`);

    // Step 2: Walk-forward split (80/20 chronological)
    const splitIdx = Math.floor(samples.length * 0.8);
    const trainSet = samples.slice(0, splitIdx);
    const valSet = samples.slice(splitIdx);

    logger.info(`${symbol}: split ${trainSet.length} train / ${valSet.length} validation`);

    // Step 3: Grid search lambda
    const X_train = trainSet.map((s) => s.features);
    const y_train = trainSet.map((s) => s.targetReturn);

    let bestModel: LinearRegressionModel | null = null;
    let bestLambda = 1.0;
    let bestScore = -Infinity;
    let bestMetrics = { mae: 0, rmse: 0, directionalAccuracy: 0, meanReturn: 0 };

    for (const lambda of LAMBDA_GRID) {
      const model = new LinearRegressionModel(lambda);
      // For short-horizon, we only predict one target (return), but the interface
      // requires high/low/close. We use close for the return prediction.
      // High and Low get the same target (we only care about close prediction here).
      model.fit(X_train, y_train, y_train, y_train);

      const metrics = this.evaluate(model, valSet);
      // Score: directional accuracy is king for trading
      const score = metrics.directionalAccuracy * 2 - metrics.mae * 1000;

      if (score > bestScore) {
        bestScore = score;
        bestModel = model;
        bestLambda = lambda;
        bestMetrics = metrics;
      }
    }

    if (!bestModel) {
      logger.error(`${symbol}: grid search failed, no model produced`);
      return null;
    }

    const durationMs = Date.now() - startTime;
    logger.info(`${symbol}: short-horizon trained in ${durationMs}ms — Lambda=${bestLambda}, Dir=${bestMetrics.directionalAccuracy.toFixed(1)}%, MAE=${(bestMetrics.mae * 100).toFixed(4)}%`);

    return {
      serializedModel: bestModel.serialize(),
      lambda: bestLambda,
      metrics: {
        ...bestMetrics,
        sampleCount: trainSet.length,
        validationSamples: valSet.length,
      },
      featureNames: this.featureEngineer.getFeatureNames(),
      featureCount: this.featureEngineer.getFeatureCount(),
    };
  }

  /**
   * Build training samples from multi-day candle data.
   * Each sample: features from 30-candle window → target return 5 minutes later.
   */
  private buildSamples(allCandles: OHLCV[]): Array<{ features: number[]; targetReturn: number }> {
    const samples: Array<{ features: number[]; targetReturn: number }> = [];

    // Group by date
    const byDate = new Map<string, OHLCV[]>();
    for (const candle of allCandles) {
      const date = candle.timestamp.split(" ")[0];
      const existing = byDate.get(date) || [];
      existing.push(candle);
      byDate.set(date, existing);
    }

    // For each day, slide a 30-candle window and compute features + target
    for (const [, dayCandles] of byDate) {
      if (dayCandles.length < ShortHorizonFeatures.LOOKBACK + FORECAST_HORIZON) continue;

      // From candle index 29 (first full window) to candle (length - 5) (must have 5 candles ahead)
      for (let i = ShortHorizonFeatures.LOOKBACK - 1; i < dayCandles.length - FORECAST_HORIZON; i++) {
        const windowCandles = dayCandles.slice(i - ShortHorizonFeatures.LOOKBACK + 1, i + 1);
        const features = this.featureEngineer.compute(windowCandles);
        if (!features) continue;

        const currentClose = dayCandles[i].close;
        const futureClose = dayCandles[i + FORECAST_HORIZON].close;

        if (currentClose <= 0) continue;

        const targetReturn = (futureClose - currentClose) / currentClose;
        samples.push({ features, targetReturn });
      }
    }

    return samples;
  }

  /**
   * Evaluate model on validation set.
   */
  private evaluate(model: LinearRegressionModel, valSet: Array<{ features: number[]; targetReturn: number }>): {
    mae: number;
    rmse: number;
    directionalAccuracy: number;
    meanReturn: number;
  } {
    let totalErr = 0;
    let totalSqErr = 0;
    let directionalCorrect = 0;
    let totalReturn = 0;

    for (const sample of valSet) {
      // Use predictClose since we trained all three heads with the same target
      const predReturn = model.predictClose(sample.features);
      const err = Math.abs(predReturn - sample.targetReturn);

      totalErr += err;
      totalSqErr += err ** 2;
      totalReturn += sample.targetReturn;

      // Directional accuracy
      const predDir = predReturn >= 0;
      const actualDir = sample.targetReturn >= 0;
      if (predDir === actualDir) directionalCorrect++;
    }

    const n = valSet.length;
    return {
      mae: totalErr / n,
      rmse: Math.sqrt(totalSqErr / n),
      directionalAccuracy: (directionalCorrect / n) * 100,
      meanReturn: totalReturn / n,
    };
  }
}
