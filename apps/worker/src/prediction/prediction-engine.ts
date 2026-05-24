import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import moment from "moment";
import { OHLCV } from "../types/market-data/ohlcv.ts";
import { FeatureVector, PreviousDayContext } from "../types/features/feature-vector.ts";
import { Prediction } from "../types/predictions/prediction.ts";
import FeatureEngineer from "../features/feature-engineer.ts";
import { TrainableModel } from "../training/models/trainable-model.ts";
import { LinearRegressionModel } from "../training/models/linear-regression-model.ts";
import { RandomForestModel } from "../training/models/random-forest-model.ts";
import { GradientBoostedModel } from "../training/models/gradient-boosted-model.ts";
import { NeuralNetworkModel } from "../training/models/neural-network-model.ts";

/**
 * Prediction engine — loads a production model and generates daily HIGH/LOW predictions.
 *
 * Flow:
 * 1. Load serialized model from disk (models/{symbol}/{version}/model.json)
 * 2. Compute features from first 45 min of 1-min OHLCV data
 * 3. Predict daily HIGH and LOW
 * 4. Return Prediction object ready for Firebase storage
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
   * @param candles First 45 min (or full day) of 1-min OHLCV candles
   * @param prevDay Previous day context for opening gap / relative volume
   * @param modelVersion Model version to load (e.g. "v1", "v2")
   * @param modelType Which algorithm was used
   * @returns Prediction or null if features/model unavailable
   */
  predict(
    symbol: string,
    date: string,
    candles: OHLCV[],
    prevDay: PreviousDayContext | null,
    modelVersion: string,
    modelType: string,
  ): Prediction | null {
    // Step 1: Compute features
    const features = this.featureEngineer.compute(symbol, date, candles, prevDay);
    if (!features) return null;

    // Step 2: Load model
    const model = this.loadModel(symbol, modelVersion, modelType);
    if (!model) return null;

    // Step 3: Predict
    const featureArray = this.featureEngineer.toNumericArray(features);
    const predictedHigh = model.predictHigh(featureArray);
    const predictedLow = model.predictLow(featureArray);

    // Step 4: Build prediction object
    // Reference price = candle close at 11:00 AM IST (scheduled prediction time)
    // Market opens at 9:15, so 11:00 = 105 minutes in (candle index ~104 for 1-min candles)
    const { price: referencePrice, time: referencePriceTime } = this.getReferencePriceAt1100(candles);

    return {
      symbol,
      date,
      predictedHigh,
      predictedLow,
      modelVersion,
      modelType,
      generatedAt: moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss"),
      confidence: this.computeConfidence(predictedHigh, predictedLow, candles),
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
   */
  loadModel(
    symbol: string,
    version: string,
    modelType: string,
  ): TrainableModel | null {
    const modelPath = join(this.modelsDir, symbol, version, "model.json");

    if (!existsSync(modelPath)) {
      return null;
    }

    const json = readFileSync(modelPath, "utf-8");

    switch (modelType) {
      case "linear-regression":
        return LinearRegressionModel.deserialize(json);
      case "random-forest":
        return RandomForestModel.deserialize(json);
      case "gradient-boosted":
        return GradientBoostedModel.deserialize(json);
      case "neural-network":
        return NeuralNetworkModel.deserialize(json);
      default:
        return null;
    }
  }

  /**
   * Get the reference price at 11:00 AM IST (scheduled prediction time).
   * This is the candle close at 11:00, which is 105 minutes after market open (9:15).
   * Falls back to the last available candle if 11:00 candle is not available.
   */
  private getReferencePriceAt1100(candles: OHLCV[]): { price: number | null; time: string | null } {
    if (candles.length === 0) return { price: null, time: null };

    // Try to find candle with timestamp matching 11:00
    for (const candle of candles) {
      const ts = candle.timestamp;
      if (ts.includes("11:00") || ts.includes("T11:00")) {
        const time = ts.includes("T") ? ts.slice(11, 16) : ts.slice(-5);
        return { price: candle.close, time };
      }
    }

    // Fallback: use candle at index 104 (105th minute = 11:00 for 1-min candles starting 9:15)
    if (candles.length > 104) {
      const ts = candles[104].timestamp;
      const time = ts.includes("T") ? ts.slice(11, 16) : (ts.length > 10 ? ts.slice(-5) : "11:00");
      return { price: candles[104].close, time };
    }

    // Final fallback: use the last available candle close
    const lastCandle = candles[candles.length - 1];
    const ts = lastCandle.timestamp;
    const time = ts.includes("T") ? ts.slice(11, 16) : (ts.length > 10 ? ts.slice(-5) : null);
    return { price: lastCandle.close, time };
  }

  /**
   * Simple confidence score based on predicted range width vs current price.
   * Narrower ranges relative to price → higher confidence.
   */
  private computeConfidence(predictedHigh: number, predictedLow: number, candles: OHLCV[]): number {
    if (candles.length === 0) return 0;

    const currentPrice = candles[candles.length - 1].close;
    if (currentPrice <= 0) return 0;

    const rangeWidth = predictedHigh - predictedLow;
    const rangePct = rangeWidth / currentPrice;

    // Confidence inversely proportional to range width
    // ~2% range → high confidence, ~10% range → low confidence
    if (rangePct <= 0.02) return 0.9;
    if (rangePct <= 0.04) return 0.7;
    if (rangePct <= 0.06) return 0.5;
    if (rangePct <= 0.08) return 0.3;
    return 0.1;
  }
}
