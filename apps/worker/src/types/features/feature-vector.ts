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
 * Previous day context needed for computing some features (opening gap).
 */
export interface PreviousDayContext {
  /** Previous day close price */
  close: number;

  /** Volume from data up to 11:00 AM (first 105 min) for relative volume comparison */
  avg45MinVolume: number;
}
