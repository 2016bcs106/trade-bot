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

/** Time interval for OHLCV data */
export type OHLCVInterval = "MINUTE" | "DAY";

/** Request parameters for fetching historical data */
export interface HistoricalDataRequest {
  /** Stock symbol */
  symbol: string;

  /** Security ID for the data provider */
  securityId: string;

  /** Exchange (NSE/BSE) */
  exchange: string;

  /** Start date (YYYY-MM-DD) */
  fromDate: string;

  /** End date (YYYY-MM-DD) */
  toDate: string;

  /** Candle interval */
  interval: OHLCVInterval;
}
