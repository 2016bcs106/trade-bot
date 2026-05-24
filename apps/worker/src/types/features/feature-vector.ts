/**
 * Complete feature vector generated from data up to 11:00 AM (first 105 minutes).
 * Used as input to ML models for predicting daily high/low.
 */
export interface FeatureVector {
  /** Stock symbol */
  symbol: string;

  /** Date this feature vector represents (YYYY-MM-DD) */
  date: string;

  // ─── Price Features ────────────────────────────────────────────────

  /** Cumulative return from open to 11:00 AM close: (close_105 - open) / open */
  cumulativeReturn: number;

  /** Opening gap: (today_open - prev_close) / prev_close */
  openingGap: number;

  /** 5-min rolling return */
  rollingReturn5: number;

  /** 15-min rolling return */
  rollingReturn15: number;

  /** 30-min rolling return */
  rollingReturn30: number;

  /** Average candle body ratio: |close - open| / (high - low) */
  avgBodyRatio: number;

  /** Average upper wick ratio: (high - max(open,close)) / (high - low) */
  avgUpperWickRatio: number;

  /** Average lower wick ratio: (min(open,close) - low) / (high - low) */
  avgLowerWickRatio: number;

  /** Price momentum: close_45 vs close_15 (direction + magnitude) */
  momentum: number;

  /** Linear regression slope of close prices over 45 candles */
  trendSlope: number;

  /** Distance from VWAP at 45-min mark: (close - vwap) / vwap */
  vwapDistance: number;

  // ─── Volatility Features ───────────────────────────────────────────

  /** Average True Range (14-period) normalized by close */
  atr14: number;

  /** Realized volatility: std(returns) over 45 candles */
  realizedVolatility: number;

  /** Rolling standard deviation of close prices (14-period) / close */
  rollingStddev14: number;

  /** Range expansion: (high_45 - low_45) / open */
  rangeExpansion: number;

  // ─── Volume Features ───────────────────────────────────────────────

  /** Cumulative volume over 45 minutes */
  cumulativeVolume: number;

  /** Relative volume: cum_volume / avg_45min_volume (from history) */
  relativeVolume: number;

  /** Max volume spike: max(volume_i) / avg(volume) */
  volumeSpike: number;

  /** Volume trend: linear regression slope of volume over 45 candles */
  volumeTrend: number;

  // ─── Historical Context Features ───────────────────────────────────

  /** Previous day (D-1) closing price */
  prevClose1: number;

  /** Previous day (D-1) daily high */
  prevHigh1: number;

  /** D-2 closing price */
  prevClose2: number;

  /** D-2 daily high */
  prevHigh2: number;

  /** D-3 closing price */
  prevClose3: number;

  /** D-3 daily high */
  prevHigh3: number;

  // ─── Time Features ─────────────────────────────────────────────────

  /** Day of week (0=Monday, 4=Friday) */
  weekday: number;

  /** Month (1-12) */
  month: number;

  /** Whether today is an expiry day (Thursday for weekly, last Thursday for monthly) */
  isExpiryDay: boolean;

  // ─── Target Variables (only available for training) ────────────────

  /** Actual intraday high (target for training, null for live prediction) */
  actualHigh?: number;

  /** Actual intraday low (target for training, null for live prediction) */
  actualLow?: number;
}

/**
 * Previous days context needed for computing features (opening gap, historical levels).
 */
export interface PreviousDayContext {
  /** Previous day close price */
  close: number;

  /** Previous day high price */
  high: number;

  /** Average minute volume from previous day (for relative volume comparison) */
  averageMinVolume: number;

  /** D-2 close price (null if unavailable) */
  close2: number | null;

  /** D-2 high price (null if unavailable) */
  high2: number | null;

  /** D-3 close price (null if unavailable) */
  close3: number | null;

  /** D-3 high price (null if unavailable) */
  high3: number | null;
}
