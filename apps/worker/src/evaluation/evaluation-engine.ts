import { nowFormatted } from "../utils/time.ts";
import { Prediction } from "../types/predictions/prediction.ts";
import { EvaluationResult } from "../types/predictions/evaluation-result.ts";

/**
 * Evaluation engine — compares predicted vs actual high/low after market close.
 *
 * Metrics computed:
 * - highError: |predictedHigh - actualHigh|
 * - lowError: |predictedLow - actualLow|
 * - MAE: (highError + lowError) / 2
 * - RMSE: sqrt((highError² + lowError²) / 2)
 * - MAPE: mean absolute percentage error
 * - Directional accuracy: did the predicted midpoint direction match actual?
 * - Range containment: was actual price within predicted range?
 */
export default class EvaluationEngine {
  /**
   * Evaluate a single prediction against actual values.
   *
   * @param prediction The prediction with actualHigh/actualLow filled in
   * @returns EvaluationResult or null if actuals not available
   */
  evaluate(prediction: Prediction): EvaluationResult | null {
    if (prediction.actualHigh === null || prediction.actualLow === null) {
      return null;
    }

    const { predictedHigh, predictedLow, actualHigh, actualLow } = prediction;

    const highError = Math.abs(predictedHigh - actualHigh);
    const lowError = Math.abs(predictedLow - actualLow);

    const mae = (highError + lowError) / 2;
    const rmse = Math.sqrt((highError ** 2 + lowError ** 2) / 2);

    // MAPE — percentage error relative to actual values
    const highPctError = actualHigh > 0 ? (highError / actualHigh) * 100 : 0;
    const lowPctError = actualLow > 0 ? (lowError / actualLow) * 100 : 0;
    const mape = (highPctError + lowPctError) / 2;

    // Directional accuracy: predicted direction vs actual direction relative to reference price
    const referencePrice = prediction.referencePrice;
    let directionalAccuracy = false;
    if (referencePrice !== null && referencePrice > 0) {
      const predictedMid = (predictedHigh + predictedLow) / 2;
      const actualMid = (actualHigh + actualLow) / 2;
      const predictedBullish = predictedMid >= referencePrice;
      const actualBullish = actualMid >= referencePrice;
      directionalAccuracy = predictedBullish === actualBullish;
    }

    // Range containment: actual high/low within predicted range
    const rangeContainment = actualHigh <= predictedHigh && actualLow >= predictedLow;

    return {
      symbol: prediction.symbol,
      date: prediction.date,
      modelVersion: prediction.modelVersion,
      highError,
      lowError,
      mae,
      rmse,
      mape,
      directionalAccuracy,
      rangeContainment,
      evaluatedAt: nowFormatted(),
    };
  }

  /**
   * Evaluate a batch of predictions and compute aggregate statistics.
   */
  evaluateBatch(predictions: Prediction[]): {
    results: EvaluationResult[];
    aggregate: AggregateMetrics;
  } {
    const results: EvaluationResult[] = [];

    for (const pred of predictions) {
      const result = this.evaluate(pred);
      if (result) {
        results.push(result);
      }
    }

    return {
      results,
      aggregate: this.computeAggregate(results),
    };
  }

  /**
   * Compare production model vs shadow model evaluation results.
   * Returns true if shadow outperforms production.
   */
  shadowOutperforms(
    productionResults: EvaluationResult[],
    shadowResults: EvaluationResult[],
  ): { outperforms: boolean; productionMAE: number; shadowMAE: number } {
    const productionMAE = this.avgMAE(productionResults);
    const shadowMAE = this.avgMAE(shadowResults);

    return {
      outperforms: shadowMAE < productionMAE * 0.95, // Shadow must be 5% better
      productionMAE,
      shadowMAE,
    };
  }

  private computeAggregate(results: EvaluationResult[]): AggregateMetrics {
    if (results.length === 0) {
      return {
        avgMAE: 0,
        avgRMSE: 0,
        avgMAPE: 0,
        directionalAccuracyPct: 0,
        rangeContainmentPct: 0,
        totalEvaluated: 0,
      };
    }

    const n = results.length;
    const avgMAE = results.reduce((s, r) => s + r.mae, 0) / n;
    const avgRMSE = results.reduce((s, r) => s + r.rmse, 0) / n;
    const avgMAPE = results.reduce((s, r) => s + r.mape, 0) / n;
    const directionalCorrect = results.filter((r) => r.directionalAccuracy).length;
    const rangeContained = results.filter((r) => r.rangeContainment).length;

    return {
      avgMAE,
      avgRMSE,
      avgMAPE,
      directionalAccuracyPct: (directionalCorrect / n) * 100,
      rangeContainmentPct: (rangeContained / n) * 100,
      totalEvaluated: n,
    };
  }

  private avgMAE(results: EvaluationResult[]): number {
    if (results.length === 0) return Infinity;
    return results.reduce((s, r) => s + r.mae, 0) / results.length;
  }
}

/**
 * Aggregate evaluation metrics across multiple predictions.
 */
export interface AggregateMetrics {
  avgMAE: number;
  avgRMSE: number;
  avgMAPE: number;
  directionalAccuracyPct: number;
  rangeContainmentPct: number;
  totalEvaluated: number;
}
