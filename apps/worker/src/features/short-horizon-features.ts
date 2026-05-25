import { OHLCV } from "../types/market-data/ohlcv.ts";

/**
 * Micro-feature engineer for short-horizon (5-min ahead) price prediction.
 *
 * Input: Last 30 one-minute OHLCV candles
 * Output: ~15 numeric features optimized for predicting the next 5-minute return
 *
 * All features are scale-invariant (returns/ratios, not absolute prices).
 */
export default class ShortHorizonFeatures {
  /** Minimum candles required */
  static readonly LOOKBACK = 30;

  /**
   * Compute feature vector from a sliding window of candles.
   * @param candles Last 30 (or more) 1-min candles, ordered chronologically
   * @returns Numeric feature array or null if insufficient data
   */
  compute(candles: OHLCV[]): number[] | null {
    if (candles.length < ShortHorizonFeatures.LOOKBACK) return null;

    // Use exactly last 30 candles
    const window = candles.slice(-ShortHorizonFeatures.LOOKBACK);
    const closes = window.map((c) => c.close);
    const volumes = window.map((c) => c.volume);
    const lastClose = closes[closes.length - 1];

    if (lastClose <= 0) return null;

    return [
      // Returns at multiple lookbacks
      this.returnN(closes, 1),      // 1-min return
      this.returnN(closes, 3),      // 3-min return
      this.returnN(closes, 5),      // 5-min return
      this.returnN(closes, 10),     // 10-min return
      this.returnN(closes, 15),     // 15-min return
      this.returnN(closes, 30),     // 30-min return (full window)

      // Momentum indicators
      this.rsi(closes, 14),         // RSI-14 (normalized to 0-1 from 0-100)
      this.priceAcceleration(closes), // Is momentum increasing?

      // Volatility
      this.realizedVolatility(closes), // Std of returns
      this.atrNormalized(window),      // ATR / lastClose

      // Volume features
      this.volumeSpike(volumes),       // Max vol / avg vol
      this.buyingPressure(window),     // % bullish candles

      // Price position
      this.vwapDistance(window),        // Distance from VWAP
      this.pricePositionInRange(window), // Where is price within 30-min range?

      // Time context (normalized 0-1 over market day)
      this.timeOfDay(window[window.length - 1].timestamp),
    ];
  }

  /**
   * Get feature names in same order as compute() output.
   */
  getFeatureNames(): string[] {
    return [
      "return_1m",
      "return_3m",
      "return_5m",
      "return_10m",
      "return_15m",
      "return_30m",
      "rsi_14",
      "price_acceleration",
      "realized_volatility",
      "atr_normalized",
      "volume_spike",
      "buying_pressure",
      "vwap_distance",
      "price_position",
      "time_of_day",
    ];
  }

  getFeatureCount(): number {
    return 15;
  }

  // ─── Feature Computations ────────────────────────────────────────

  private returnN(closes: number[], n: number): number {
    if (closes.length <= n) return 0;
    const current = closes[closes.length - 1];
    const past = closes[closes.length - 1 - n];
    return past > 0 ? (current - past) / past : 0;
  }

  private rsi(closes: number[], period: number): number {
    if (closes.length < period + 1) return 0.5;

    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    for (let i = period + 1; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      }
    }

    if (avgLoss === 0) return 1.0;
    const rs = avgGain / avgLoss;
    return (100 - 100 / (1 + rs)) / 100; // Normalize to 0-1
  }

  private priceAcceleration(closes: number[]): number {
    if (closes.length < 10) return 0;
    // Compare recent 5-bar return vs older 5-bar return
    const recent5 = this.returnN(closes, 5);
    const older = closes.length >= 10
      ? (closes[closes.length - 6] - closes[closes.length - 11]) / (closes[closes.length - 11] || 1)
      : 0;
    return recent5 - older;
  }

  private realizedVolatility(closes: number[]): number {
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) {
        returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
      }
    }
    if (returns.length < 2) return 0;
    const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
    const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance);
  }

  private atrNormalized(candles: OHLCV[]): number {
    if (candles.length < 2) return 0;
    const lastClose = candles[candles.length - 1].close;
    if (lastClose <= 0) return 0;

    let sumTR = 0;
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close),
      );
      sumTR += tr;
    }

    return (sumTR / (candles.length - 1)) / lastClose;
  }

  private volumeSpike(volumes: number[]): number {
    if (volumes.length === 0) return 0;
    const avg = volumes.reduce((s, v) => s + v, 0) / volumes.length;
    if (avg === 0) return 0;
    return volumes[volumes.length - 1] / avg; // Last bar volume vs average
  }

  private buyingPressure(candles: OHLCV[]): number {
    if (candles.length === 0) return 0.5;
    // Use last 10 candles for more recent buying pressure
    const recent = candles.slice(-10);
    const bullish = recent.filter((c) => c.close > c.open).length;
    return bullish / recent.length;
  }

  private vwapDistance(candles: OHLCV[]): number {
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    for (const c of candles) {
      const tp = (c.high + c.low + c.close) / 3;
      cumulativeTPV += tp * c.volume;
      cumulativeVolume += c.volume;
    }

    if (cumulativeVolume === 0) return 0;
    const vwap = cumulativeTPV / cumulativeVolume;
    const lastClose = candles[candles.length - 1].close;
    return (lastClose - vwap) / vwap;
  }

  private pricePositionInRange(candles: OHLCV[]): number {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const rangeHigh = Math.max(...highs);
    const rangeLow = Math.min(...lows);
    const range = rangeHigh - rangeLow;
    if (range <= 0) return 0.5;
    const lastClose = candles[candles.length - 1].close;
    return (lastClose - rangeLow) / range; // 0 = at low, 1 = at high
  }

  private timeOfDay(timestamp: string): number {
    // Extract HH:mm from timestamp "YYYY-MM-DD HH:mm"
    const timePart = timestamp.split(" ")[1] || "12:00";
    const [hh, mm] = timePart.split(":").map(Number);
    const minutesSinceOpen = (hh * 60 + mm) - (9 * 60 + 15); // Market opens 9:15
    // Normalize to 0-1 over 375 minute trading day
    return Math.max(0, Math.min(1, minutesSinceOpen / 375));
  }
}
