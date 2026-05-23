/**
 * Evaluation result stored at `predictions/SYMBOL/YYYY-MM-DD/evaluation/`
 * Generated after market close by comparing predicted vs actual high/low.
 */
export interface EvaluationResult {
  /** Stock symbol */
  symbol: string;

  /** Evaluation date (YYYY-MM-DD) */
  date: string;

  /** Model version that was evaluated */
  modelVersion: string;

  /** Absolute error on high prediction */
  highError: number;

  /** Absolute error on low prediction */
  lowError: number;

  /** Mean Absolute Error across high and low */
  mae: number;

  /** Root Mean Square Error across high and low */
  rmse: number;

  /** Mean Absolute Percentage Error (%) */
  mape: number;

  /** Whether predicted direction (up/down from open) matched actual */
  directionalAccuracy: boolean;

  /**
   * Whether actual high/low fell within the predicted range.
   * true if actualHigh <= predictedHigh AND actualLow >= predictedLow
   */
  rangeContainment: boolean;

  /** ISO timestamp when evaluation was completed */
  evaluatedAt: number;
}
