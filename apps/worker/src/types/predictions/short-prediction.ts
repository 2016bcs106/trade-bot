/**
 * Short-horizon prediction record stored at `short_predictions/SYMBOL/YYYY-MM-DD/HH:mm`
 * Generated every minute during market hours using last 30 minutes of OHLCV data.
 * Predicts the price 5 minutes into the future.
 */
export interface ShortPrediction {
  /** Stock symbol */
  symbol: string;

  /** Prediction date (YYYY-MM-DD) */
  date: string;

  /** Time prediction was generated (HH:mm) */
  time: string;

  /** Current price when prediction was made (last candle close) */
  currentPrice: number;

  /** Predicted price 5 minutes from now */
  predictedPrice: number;

  /** Predicted return: (predictedPrice - currentPrice) / currentPrice */
  predictedReturn: number;

  /** Predicted direction based on sign of predictedReturn */
  direction: "Bullish" | "Bearish" | "Neutral";

  /** Confidence score (0-1) */
  confidence: number;

  /** Model version used */
  modelVersion: string;

  /** ISO timestamp when prediction was generated */
  generatedAt: string;

  /** Actual price 5 minutes later (filled for evaluation), null until then */
  actualPrice: number | null;

  /** Absolute percentage error once evaluated, null until then */
  error: number | null;

  /** Whether this prediction has been evaluated */
  evaluated: boolean;
}
