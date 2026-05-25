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

  /** Predicted closing price (3:30 PM) */
  predictedClose: number;

  /** Predicted direction based on predictedClose vs referencePrice */
  direction: "Bullish" | "Bearish";

  /** Model version used for this prediction (e.g., "v3") */
  modelVersion: string;

  /** Model type that generated this prediction */
  modelType: string;

  /** Confidence score (0-1) if available, null otherwise */
  confidence: number | null;

  /** ISO timestamp when prediction was first generated (YYYY-MM-DD HH:mm:ss) */
  generatedAt: string;

  /** ISO timestamp when prediction was last updated by rolling forecast (YYYY-MM-DD HH:mm:ss) */
  updatedAt: string;

  /** Window size (minutes elapsed from market open) used for this prediction */
  windowSize: number;

  /** Price at the time prediction was made (last candle close in feature window) */
  referencePrice: number;

  /** Timestamp of the reference price candle (e.g. "11:00") */
  referencePriceTime: string;

  /** Actual intraday high (filled after market close), null until evaluated */
  actualHigh: number | null;

  /** Actual intraday low (filled after market close), null until evaluated */
  actualLow: number | null;

  /** Actual closing price (filled after market close), null until evaluated */
  actualClose: number | null;

  /** Whether evaluation has been completed for this prediction */
  evaluated: boolean;
}
