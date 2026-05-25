import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { nowFormatted } from "../utils/time.ts";
import { OHLCV } from "../types/market-data/ohlcv.ts";
import { ShortPrediction } from "../types/predictions/short-prediction.ts";
import ShortHorizonFeatures from "../features/short-horizon-features.ts";
import { LinearRegressionModel } from "../training/models/linear-regression-model.ts";

/**
 * Short-horizon predictor — generates 5-minute-ahead price predictions.
 *
 * Usage:
 * - Call `predict()` every minute with the last 30+ candles
 * - Returns a ShortPrediction object ready to save to Firebase
 * - Model is loaded once and cached for the session
 *
 * Firebase path: short_predictions/{symbol}/{date}/{HH:mm}
 */
export default class ShortHorizonPredictor {
  private featureEngineer: ShortHorizonFeatures;
  private modelsDir: string;
  private modelCache: Map<string, LinearRegressionModel> = new Map();

  constructor(modelsDir: string = join(process.cwd(), "models")) {
    this.featureEngineer = new ShortHorizonFeatures();
    this.modelsDir = modelsDir;
  }

  /**
   * Generate a 5-min-ahead prediction from recent candles.
   *
   * @param symbol Stock symbol
   * @param date Current date (YYYY-MM-DD)
   * @param candles Last 30+ 1-min candles (most recent at end)
   * @param modelVersion Model version to use (e.g. "v3")
   * @returns ShortPrediction or null if model/features unavailable
   */
  predict(
    symbol: string,
    date: string,
    candles: OHLCV[],
    modelVersion: string,
  ): ShortPrediction | null {
    if (candles.length < ShortHorizonFeatures.LOOKBACK) return null;

    // Compute features
    const features = this.featureEngineer.compute(candles);
    if (!features) return null;

    // Load model (cached)
    const model = this.loadModel(symbol, modelVersion);
    if (!model) return null;

    // Predict return (using predictClose since all heads trained with same target)
    const predictedReturn = model.predictClose(features);

    // Current price = last candle close
    const lastCandle = candles[candles.length - 1];
    const currentPrice = lastCandle.close;
    const predictedPrice = currentPrice * (1 + predictedReturn);

    // Direction
    const direction: "Bullish" | "Bearish" | "Neutral" =
      predictedReturn > 0.0001 ? "Bullish" :
      predictedReturn < -0.0001 ? "Bearish" : "Neutral";

    // Confidence based on return magnitude and feature agreement
    const confidence = this.computeConfidence(predictedReturn, features);

    // Extract time from last candle timestamp
    const time = lastCandle.timestamp.split(" ")[1] || "00:00";

    return {
      symbol,
      date,
      time,
      currentPrice,
      predictedPrice: Math.round(predictedPrice * 100) / 100,
      predictedReturn: Math.round(predictedReturn * 100000) / 100000,
      direction,
      confidence,
      modelVersion,
      generatedAt: nowFormatted(),
      actualPrice: null,
      error: null,
      evaluated: false,
    };
  }

  /**
   * Load the short-horizon model for a symbol/version.
   * Caches the model after first load.
   */
  private loadModel(symbol: string, version: string): LinearRegressionModel | null {
    const cacheKey = `${symbol}:${version}`;
    if (this.modelCache.has(cacheKey)) {
      return this.modelCache.get(cacheKey)!;
    }

    const modelPath = join(this.modelsDir, symbol, version, "short-horizon-5min.json");
    if (!existsSync(modelPath)) return null;

    try {
      const json = readFileSync(modelPath, "utf-8");
      const model = LinearRegressionModel.deserialize(json);
      this.modelCache.set(cacheKey, model);
      return model;
    } catch {
      return null;
    }
  }

  /**
   * Clear cached models (call when a new model version is trained).
   */
  clearCache(): void {
    this.modelCache.clear();
  }

  /**
   * Compute confidence for a short-horizon prediction.
   * Based on predicted return magnitude and feature signals.
   */
  private computeConfidence(predictedReturn: number, features: number[]): number {
    let score = 0;

    const absReturn = Math.abs(predictedReturn);

    // Factor 1: Return magnitude (0-35 points)
    if (absReturn >= 0.003) score += 35;       // >0.3% in 5 min = strong signal
    else if (absReturn >= 0.0015) score += 25; // >0.15%
    else if (absReturn >= 0.0005) score += 15; // >0.05%
    else score += 5;                            // very small predicted move

    // Factor 2: RSI not extreme (0-20 points)
    // features[6] = rsi_14 (normalized 0-1)
    const rsi = features[6] ?? 0.5;
    const isBullish = predictedReturn >= 0;
    if (isBullish && rsi < 0.7) score += 20;       // Not overbought
    else if (!isBullish && rsi > 0.3) score += 20; // Not oversold
    else score += 5;

    // Factor 3: Momentum agreement (0-25 points)
    // features[2] = return_5m, features[7] = price_acceleration
    const return5m = features[2] ?? 0;
    const acceleration = features[7] ?? 0;
    const momentumAgrees = isBullish
      ? return5m > 0 && acceleration > 0
      : return5m < 0 && acceleration < 0;
    if (momentumAgrees) score += 25;
    else if (isBullish ? return5m > 0 : return5m < 0) score += 12;

    // Factor 4: Volume confirmation (0-20 points)
    // features[11] = buying_pressure
    const buyingPressure = features[11] ?? 0.5;
    const volumeAgrees = isBullish ? buyingPressure > 0.5 : buyingPressure < 0.5;
    if (volumeAgrees) score += 20;

    // Normalize to 0.1-0.9
    const confidence = Math.max(0.1, Math.min(0.9, score / 100));
    return Math.round(confidence * 10) / 10;
  }
}
