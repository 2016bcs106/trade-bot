import { OHLCV } from "../types/market-data/ohlcv.ts";
import { FeatureVector, PreviousDayContext } from "../types/features/feature-vector.ts";

/**
 * Feature engineering pipeline for intraday prediction.
 *
 * Generates a complete feature vector from the first 45 minutes of 1-min OHLCV data.
 * All features are designed to be computable BEFORE market close (no future leakage).
 *
 * Market hours: 9:15 AM - 3:30 PM IST
 * Feature window: 9:15 AM - 10:00 AM (first 45 candles)
 */
export default class FeatureEngineer {
  /** Number of 1-min candles to use (first 45 minutes) */
  private readonly WINDOW_SIZE = 45;

  /**
   * Compute the full feature vector from a day's 1-min OHLCV candles.
   *
   * @param symbol Stock symbol
   * @param date Date string (YYYY-MM-DD)
   * @param candles All 1-min OHLCV candles for the day (will be truncated to first 45)
   * @param prevDay Previous day context for computing opening gap and relative volume
   * @returns FeatureVector or null if insufficient data
   */
  compute(
    symbol: string,
    date: string,
    candles: OHLCV[],
    prevDay: PreviousDayContext | null,
  ): FeatureVector | null {
    // Use only first 45 candles
    const window = candles.slice(0, this.WINDOW_SIZE);

    if (window.length < 30) {
      // Need at least 30 candles for meaningful features
      return null;
    }

    const closes = window.map((c) => c.close);
    const opens = window.map((c) => c.open);
    const highs = window.map((c) => c.high);
    const lows = window.map((c) => c.low);
    const volumes = window.map((c) => c.volume);

    const firstOpen = opens[0];
    const lastClose = closes[closes.length - 1];
    const windowHigh = Math.max(...highs);
    const windowLow = Math.min(...lows);

    return {
      symbol,
      date,

      // Price features
      cumulativeReturn: (lastClose - firstOpen) / firstOpen,
      openingGap: prevDay ? (firstOpen - prevDay.close) / prevDay.close : 0,
      rollingReturn5: this.rollingReturn(closes, 5),
      rollingReturn15: this.rollingReturn(closes, 15),
      rollingReturn30: this.rollingReturn(closes, 30),
      avgBodyRatio: this.avgBodyRatio(window),
      avgUpperWickRatio: this.avgUpperWickRatio(window),
      avgLowerWickRatio: this.avgLowerWickRatio(window),
      momentum: this.momentum(closes),
      trendSlope: this.linearSlope(closes),
      vwapDistance: this.vwapDistance(window),

      // Volatility features
      atr14: this.atr(window, 14) / lastClose,
      realizedVolatility: this.realizedVolatility(closes),
      rollingStddev14: this.rollingStddev(closes, 14) / lastClose,
      rangeExpansion: (windowHigh - windowLow) / firstOpen,

      // Volume features
      cumulativeVolume: volumes.reduce((sum, v) => sum + v, 0),
      relativeVolume: prevDay && prevDay.avg45MinVolume > 0
        ? volumes.reduce((sum, v) => sum + v, 0) / prevDay.avg45MinVolume
        : 1,
      volumeSpike: this.volumeSpike(volumes),
      volumeTrend: this.linearSlope(volumes),

      // Time features
      weekday: new Date(date).getDay() === 0 ? 6 : new Date(date).getDay() - 1, // 0=Mon, 4=Fri
      month: new Date(date).getMonth() + 1,
      isExpiryDay: this.isExpiryDay(date),
    };
  }

  /**
   * Extract feature values as a numeric array (for ML model input).
   * Excludes symbol, date, and target variables.
   */
  toNumericArray(features: FeatureVector): number[] {
    return [
      features.cumulativeReturn,
      features.openingGap,
      features.rollingReturn5,
      features.rollingReturn15,
      features.rollingReturn30,
      features.avgBodyRatio,
      features.avgUpperWickRatio,
      features.avgLowerWickRatio,
      features.momentum,
      features.trendSlope,
      features.vwapDistance,
      features.atr14,
      features.realizedVolatility,
      features.rollingStddev14,
      features.rangeExpansion,
      features.cumulativeVolume,
      features.relativeVolume,
      features.volumeSpike,
      features.volumeTrend,
      features.weekday,
      features.month,
      features.isExpiryDay ? 1 : 0,
    ];
  }

  /**
   * Get feature names matching the numeric array order.
   */
  getFeatureNames(): string[] {
    return [
      "cumulativeReturn",
      "openingGap",
      "rollingReturn5",
      "rollingReturn15",
      "rollingReturn30",
      "avgBodyRatio",
      "avgUpperWickRatio",
      "avgLowerWickRatio",
      "momentum",
      "trendSlope",
      "vwapDistance",
      "atr14",
      "realizedVolatility",
      "rollingStddev14",
      "rangeExpansion",
      "cumulativeVolume",
      "relativeVolume",
      "volumeSpike",
      "volumeTrend",
      "weekday",
      "month",
      "isExpiryDay",
    ];
  }

  // ─── Price Feature Helpers ─────────────────────────────────────────

  private rollingReturn(closes: number[], period: number): number {
    if (closes.length < period) return 0;
    const recent = closes[closes.length - 1];
    const past = closes[closes.length - 1 - period];
    return (recent - past) / past;
  }

  private avgBodyRatio(candles: OHLCV[]): number {
    let sum = 0;
    let count = 0;
    for (const c of candles) {
      const range = c.high - c.low;
      if (range > 0) {
        sum += Math.abs(c.close - c.open) / range;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  private avgUpperWickRatio(candles: OHLCV[]): number {
    let sum = 0;
    let count = 0;
    for (const c of candles) {
      const range = c.high - c.low;
      if (range > 0) {
        sum += (c.high - Math.max(c.open, c.close)) / range;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  private avgLowerWickRatio(candles: OHLCV[]): number {
    let sum = 0;
    let count = 0;
    for (const c of candles) {
      const range = c.high - c.low;
      if (range > 0) {
        sum += (Math.min(c.open, c.close) - c.low) / range;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  private momentum(closes: number[]): number {
    if (closes.length < 15) return 0;
    const current = closes[closes.length - 1];
    const past = closes[closes.length - 15];
    return (current - past) / past;
  }

  private vwapDistance(candles: OHLCV[]): number {
    let cumulativeTPV = 0; // typical price * volume
    let cumulativeVolume = 0;

    for (const c of candles) {
      const typicalPrice = (c.high + c.low + c.close) / 3;
      cumulativeTPV += typicalPrice * c.volume;
      cumulativeVolume += c.volume;
    }

    if (cumulativeVolume === 0) return 0;

    const vwap = cumulativeTPV / cumulativeVolume;
    const lastClose = candles[candles.length - 1].close;
    return (lastClose - vwap) / vwap;
  }

  // ─── Volatility Feature Helpers ────────────────────────────────────

  private atr(candles: OHLCV[], period: number): number {
    if (candles.length < period + 1) return 0;

    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose),
      );
      trueRanges.push(tr);
    }

    // Simple average of last `period` true ranges
    const recent = trueRanges.slice(-period);
    return recent.reduce((s, v) => s + v, 0) / recent.length;
  }

  private realizedVolatility(closes: number[]): number {
    const returns = this.logReturns(closes);
    if (returns.length === 0) return 0;
    return this.stddev(returns);
  }

  private rollingStddev(values: number[], period: number): number {
    if (values.length < period) return 0;
    const recent = values.slice(-period);
    return this.stddev(recent);
  }

  // ─── Volume Feature Helpers ────────────────────────────────────────

  private volumeSpike(volumes: number[]): number {
    if (volumes.length === 0) return 0;
    const avg = volumes.reduce((s, v) => s + v, 0) / volumes.length;
    if (avg === 0) return 0;
    return Math.max(...volumes) / avg;
  }

  // ─── Time Feature Helpers ──────────────────────────────────────────

  private isExpiryDay(date: string): boolean {
    const d = new Date(date);
    // Weekly expiry is Thursday (day 4)
    return d.getDay() === 4;
  }

  // ─── Math Utilities ────────────────────────────────────────────────

  private linearSlope(values: number[]): number {
    const n = values.length;
    if (n < 2) return 0;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) return 0;

    return (n * sumXY - sumX * sumY) / denominator;
  }

  private logReturns(closes: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) {
        returns.push(Math.log(closes[i] / closes[i - 1]));
      }
    }
    return returns;
  }

  private stddev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }
}
