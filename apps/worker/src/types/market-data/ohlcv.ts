/**
 * OHLCV (Open, High, Low, Close, Volume) candlestick data point.
 * Used for feature engineering and model training.
 */
export interface OHLCV {
  /** ISO date string (YYYY-MM-DD) for daily, or datetime for intraday */
  timestamp: string;

  /** Opening price */
  open: number;

  /** Highest price in the period */
  high: number;

  /** Lowest price in the period */
  low: number;

  /** Closing price */
  close: number;

  /** Trading volume */
  volume: number;
}

