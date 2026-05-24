/**
 * Prediction record stored at `predictions/SYMBOL/YYYY-MM-DD/`
 * Generated before market open using first 45 minutes of previous day data.
 */
export interface Prediction {
  /** Stock symbol */
  symbol: string;

  /** Prediction date (YYYY-MM-DD) */
  date: string;

  /** Predicted intraday high price */
  predictedHigh: number;

  /** Predicted intraday low price */
  predictedLow: number;

  /** Model version used for this prediction (e.g., "v3") */
  modelVersion: string;

  /** Model type that generated this prediction */
  modelType: string;

  /** Confidence score (0-1) if available, null otherwise */
  confidence: number | null;

  /** ISO timestamp when prediction was generated (YYYY-MM-DD HH:mm:ss) */
  generatedAt: string;

  /** Price at the time prediction was made (11:00 AM IST candle close) */
  referencePrice: number | null;

  /** Timestamp of the reference price candle (e.g. "11:00") */
  referencePriceTime: string | null;

  /** Actual intraday high (filled after market close), null until evaluated */
  actualHigh: number | null;

  /** Actual intraday low (filled after market close), null until evaluated */
  actualLow: number | null;

  /** Whether evaluation has been completed for this prediction */
  evaluated: boolean;
}
