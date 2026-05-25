import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { nowFormatted } from "../utils/time.ts";
import { OHLCV } from "../types/market-data/ohlcv.ts";
import { FeatureVector, PreviousDayContext } from "../types/features/feature-vector.ts";
import { Prediction } from "../types/predictions/prediction.ts";
import FeatureEngineer from "../features/feature-engineer.ts";
import { TrainableModel } from "../training/models/trainable-model.ts";
import { LinearRegressionModel } from "../training/models/linear-regression-model.ts";

/**
 * Prediction engine — loads a production model and generates daily HIGH/LOW predictions.
 *
 * v2 Changes:
 * - Model now predicts RETURNS (% change from reference price)
 * - Reconstructs absolute prices: predictedHigh = refPrice * (1 + predictedReturn)
 * - Direction-specific confidence based on predicted return magnitude
 *
 * Flow:
 * 1. Load serialized model from disk (models/{symbol}/{version}/model.json)
 * 2. Compute features from first N min of 1-min OHLCV data
 * 3. Predict returns for HIGH, LOW, CLOSE
 * 4. Reconstruct absolute prices and determine direction
 * 5. Return Prediction object ready for Firebase storage
 */
export default class PredictionEngine {
  private featureEngineer: FeatureEngineer;
  private modelsDir: string;

  constructor(modelsDir: string = join(process.cwd(), "models")) {
    this.featureEngineer = new FeatureEngineer();
    this.modelsDir = modelsDir;
  }

  /**
   * Generate a prediction for a given stock and date.
   *
   * @param symbol Stock symbol
   * @param date Date string (YYYY-MM-DD)
   * @param candles First N min (or full day) of 1-min OHLCV candles
   * @param prevDay Previous day context for opening gap / relative volume
   * @param modelVersion Model version to load (e.g. "v1", "v2")
   * @param modelType Which algorithm was used
   * @param windowSize Number of candles to use
   * @returns Prediction or null if features/model unavailable
   */
  predict(
    symbol: string,
    date: string,
    candles: OHLCV[],
    prevDay: PreviousDayContext | null,
    modelVersion: string,
    modelType: string,
    windowSize: number,
  ): Prediction | null {
    // Step 1: Compute features
    const features = this.featureEngineer.compute(symbol, date, candles, prevDay, windowSize);
    if (!features) return null;

    // Step 2: Load model (horizon-specific if available)
    const model = this.loadModel(symbol, modelVersion, modelType, windowSize);
    if (!model) return null;

    // Step 3: Predict returns
    const featureArray = this.featureEngineer.toNumericArray(features);
    const predictedHighReturn = model.predictHigh(featureArray);
    const predictedLowReturn = model.predictLow(featureArray);
    const predictedCloseReturn = model.predictClose(featureArray);

    // Step 4: Get reference price and reconstruct absolute prices
    const { price: referencePrice, time: referencePriceTime } = this.getReferencePrice(candles, windowSize);
    const predictedHigh = referencePrice * (1 + predictedHighReturn);
    const predictedLow = referencePrice * (1 + predictedLowReturn);
    const predictedClose = referencePrice * (1 + predictedCloseReturn);

    // Step 5: Determine direction from predicted return sign
    const direction: "Bullish" | "Bearish" = predictedCloseReturn >= 0 ? "Bullish" : "Bearish";

    // Step 6: Compute direction-specific confidence
    const confidence = this.computeDirectionalConfidence(
      predictedCloseReturn,
      predictedHighReturn,
      predictedLowReturn,
      features,
    );

    const timestamp = nowFormatted();
    return {
      symbol,
      date,
      predictedHigh,
      predictedLow,
      predictedClose,
      direction,
      modelVersion,
      modelType,
      generatedAt: timestamp,
      updatedAt: timestamp,
      windowSize,
      confidence,
      referencePrice,
      referencePriceTime,
      actualHigh: null,
      actualLow: null,
      actualClose: null,
      evaluated: false,
    };
  }

  /**
   * Generate prediction from a pre-computed feature vector (for batch processing).
   */
  predictFromFeatures(
    features: FeatureVector,
    model: TrainableModel,
  ): { predictedHigh: number; predictedLow: number } {
    const featureArray = this.featureEngineer.toNumericArray(features);
    return {
      predictedHigh: model.predictHigh(featureArray),
      predictedLow: model.predictLow(featureArray),
    };
  }

  /**
   * Load a serialized model from disk.
   * For horizon-specific models, tries `model-{windowSize}.json` first, falls back to `model.json`.
   */
  loadModel(
    symbol: string,
    version: string,
    modelType: string,
    windowSize?: number,
  ): TrainableModel | null {
    // Try horizon-specific model file first
    let modelPath: string;
    if (windowSize) {
      const horizonPath = join(this.modelsDir, symbol, version, `model-${windowSize}.json`);
      modelPath = existsSync(horizonPath) ? horizonPath : join(this.modelsDir, symbol, version, "model.json");
    } else {
      modelPath = join(this.modelsDir, symbol, version, "model.json");
    }

    if (!existsSync(modelPath)) {
      return null;
    }

    const json = readFileSync(modelPath, "utf-8");

    switch (modelType) {
      case "linear-regression":
        return LinearRegressionModel.deserialize(json);
      default:
        return null;
    }
  }

  /**
   * Get the reference price — always uses the last candle in the window.
   * This is the most recent price available at prediction time, appropriate for all horizons.
   * Timestamps are already in IST format (YYYY-MM-DD HH:mm).
   */
  private getReferencePrice(candles: OHLCV[], windowSize: number): { price: number; time: string } {
    // Use the last candle within the window (not beyond it)
    const windowEnd = Math.min(windowSize, candles.length) - 1;
    const refCandle = candles[windowEnd];
    const time = refCandle.timestamp.split(" ")[1] || "09:15";
    return { price: refCandle.close, time };
  }

  /**
   * v2: Direction-specific confidence based on:
   * 1. Magnitude of predicted close return (larger = more confident)
   * 2. Agreement between direction and momentum features
   * 3. Range asymmetry (if predicted range favors one direction)
   *
   * Returns 0.1 to 0.9
   */
  private computeDirectionalConfidence(
    predictedCloseReturn: number,
    predictedHighReturn: number,
    predictedLowReturn: number,
    features: FeatureVector,
  ): number {
    let score = 0;

    // Factor 1: Magnitude of predicted return (0-30 points)
    // Larger predicted moves = model is more certain about direction
    const absReturn = Math.abs(predictedCloseReturn);
    if (absReturn >= 0.015) score += 30;       // >1.5% predicted move
    else if (absReturn >= 0.008) score += 20;  // >0.8%
    else if (absReturn >= 0.003) score += 10;  // >0.3%
    // <0.3% = near zero, model is uncertain

    // Factor 2: Agreement with intraday momentum (0-25 points)
    const isBullish = predictedCloseReturn >= 0;
    const momentumAgrees = isBullish
      ? features.cumulativeReturn > 0 && features.momentum > 0
      : features.cumulativeReturn < 0 && features.momentum < 0;
    if (momentumAgrees) score += 25;
    else if (isBullish ? features.cumulativeReturn > 0 : features.cumulativeReturn < 0) score += 12;

    // Factor 3: RSI confirmation (0-15 points)
    // If predicting bullish and RSI is not overbought, or bearish and not oversold
    const rsiConfirms = isBullish
      ? features.rsiIntraday < 70  // not overbought for bullish
      : features.rsiIntraday > 30; // not oversold for bearish
    if (rsiConfirms) score += 15;

    // Factor 4: Volume-weighted direction agreement (0-15 points)
    const vwdAgrees = isBullish
      ? features.volumeWeightedDirection > 0
      : features.volumeWeightedDirection < 0;
    if (vwdAgrees) score += 15;

    // Factor 5: Range asymmetry (0-15 points)
    // If high return is larger than |low return|, it's bullish-biased
    const rangeAgreement = isBullish
      ? predictedHighReturn > Math.abs(predictedLowReturn)
      : Math.abs(predictedLowReturn) > predictedHighReturn;
    if (rangeAgreement) score += 15;

    // Convert 0-100 score to 0.1-0.9 confidence
    const confidence = Math.max(0.1, Math.min(0.9, score / 100));
    return Math.round(confidence * 10) / 10; // Round to 1 decimal
  }
}
