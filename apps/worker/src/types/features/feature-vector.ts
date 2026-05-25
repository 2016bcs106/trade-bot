/**
 * Complete feature vector generated from intraday candles.
 * Used as input to ML models for predicting daily high/low/close.
 *
 * v2: Replaced absolute price features with relative features for better
 * directional accuracy. Added directional momentum features.
 */
export interface FeatureVector {
  /** Stock symbol */
  symbol: string;

  /** Date this feature vector represents (YYYY-MM-DD) */
  date: string;

  // ─── Price Features ────────────────────────────────────────────────

  /** Cumulative return from open to window close: (close_N - open) / open */
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

  /** Price momentum: close_N vs close_(N-15) (direction + magnitude) */
  momentum: number;

  /** Linear regression slope of close prices over window candles */
  trendSlope: number;

  /** Distance from VWAP: (close - vwap) / vwap */
  vwapDistance: number;

  // ─── Volatility Features ───────────────────────────────────────────

  /** Average True Range (14-period) normalized by close */
  atr14: number;

  /** Realized volatility: std(returns) over window candles */
  realizedVolatility: number;

  /** Rolling standard deviation of close prices (14-period) / close */
  rollingStddev14: number;

  /** Range expansion: (high_N - low_N) / open */
  rangeExpansion: number;

  // ─── Volume Features ───────────────────────────────────────────────

  /** Cumulative volume over window */
  cumulativeVolume: number;

  /** Relative volume: cum_volume / avg_volume (from history) */
  relativeVolume: number;

  /** Max volume spike: max(volume_i) / avg(volume) */
  volumeSpike: number;

  /** Volume trend: linear regression slope of volume over window */
  volumeTrend: number;

  // ─── Relative Historical Context Features (v2) ─────────────────────
  // All relative to current price — no absolute prices

  /** D-1 return: (prevClose1 - prevClose2) / prevClose2 */
  prevReturn1: number;

  /** D-2 return: (prevClose2 - prevClose3) / prevClose3 */
  prevReturn2: number;

  /** 3-day trend: (prevClose1 - prevClose3) / prevClose3 */
  prevTrend3d: number;

  /** D-1 normalized range: (prevHigh1 - prevLow1) / prevClose1 */
  prevRange1: number;

  /** D-2 normalized range: (prevHigh2 - prevLow2) / prevClose2 */
  prevRange2: number;

  /** D-1 close position within range: (prevClose1 - prevLow1) / (prevHigh1 - prevLow1) */
  prevPosition1: number;

  /** D-2 close position within range: (prevClose2 - prevLow2) / (prevHigh2 - prevLow2) */
  prevPosition2: number;

  /** Deviation from 3-day moving average: (currentPrice - avg(prevClose1..3)) / avg */
  priceFromMA3: number;

  /** Opening gap relative to D-1 range: gap / prevRange1 (how big is today's gap vs yesterday's range) */
  gapToRangeRatio: number;

  // ─── Directional Momentum Features (v2) ─────────────────────────────

  /** Intraday RSI (14-period): 0-100, measures overbought/oversold within window */
  rsiIntraday: number;

  /** Buying pressure: % of candles where close > open */
  buyingPressure: number;

  /** Volume-weighted direction: sum(volume * sign(close-open)) / totalVolume [-1, 1] */
  volumeWeightedDirection: number;

  /** Price acceleration: slope of returns (is momentum increasing or decreasing?) */
  priceAcceleration: number;

  /** Last N bars strength: cumReturn of last 1/3 vs first 1/3 of window */
  lastBarsStrength: number;

  /** Intraday momentum ratio: avg(positive returns) / avg(|negative returns|) */
  intradayMomentumRatio: number;

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

  /** Previous day low price */
  low: number;

  /** Average minute volume from previous day (for relative volume comparison) */
  averageMinVolume: number;

  /** D-2 close price (null if unavailable) */
  close2: number | null;

  /** D-2 high price (null if unavailable) */
  high2: number | null;

  /** D-2 low price (null if unavailable) */
  low2: number | null;

  /** D-3 close price (null if unavailable) */
  close3: number | null;

  /** D-3 high price (null if unavailable) */
  high3: number | null;

  /** D-3 low price (null if unavailable) */
  low3: number | null;
}
