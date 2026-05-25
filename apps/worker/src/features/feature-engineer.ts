import { OHLCV } from "../types/market-data/ohlcv.ts";
import { FeatureVector, PreviousDayContext } from "../types/features/feature-vector.ts";

/**
 * Feature engineering pipeline for intraday prediction.
 *
 * v2: Redesigned for better directional accuracy:
 * - Replaced absolute price features with relative/normalized features
 * - Added directional momentum features (RSI, buying pressure, momentum ratio)
 * - All features are scale-invariant (works across different price levels)
 *
 * Market hours: 9:15 AM - 3:30 PM IST (375 minutes total)
 * Window size is always provided by the caller (horizon-specific models).
 */
export default class FeatureEngineer {
  /**
   * Compute the full feature vector from a day's 1-min OHLCV candles.
   *
   * @param symbol Stock symbol
   * @param date Date string (YYYY-MM-DD)
   * @param candles All 1-min OHLCV candles for the day
   * @param prevDay Previous day context for computing opening gap and relative volume
   * @param windowSize Number of candles required from the start of the day
   * @returns FeatureVector or null if candles.length < windowSize
   */
  compute(
    symbol: string,
    date: string,
    candles: OHLCV[],
    prevDay: PreviousDayContext | null,
    windowSize: number,
  ): FeatureVector | null {
    if (candles.length < windowSize) {
      return null;
    }

    const window = candles.slice(0, windowSize);

    const closes = window.map((c) => c.close);
    const opens = window.map((c) => c.open);
    const highs = window.map((c) => c.high);
    const lows = window.map((c) => c.low);
    const volumes = window.map((c) => c.volume);

    const firstOpen = opens[0];
    const lastClose = closes[closes.length - 1];
    const windowHigh = Math.max(...highs);
    const windowLow = Math.min(...lows);

    // Previous day values with fallback chains
    const prevClose1 = prevDay?.close ?? firstOpen;
    const prevHigh1 = prevDay?.high ?? firstOpen;
    const prevLow1 = prevDay?.low ?? firstOpen;
    const prevClose2 = prevDay?.close2 ?? prevClose1;
    const prevHigh2 = prevDay?.high2 ?? prevHigh1;
    const prevLow2 = prevDay?.low2 ?? prevLow1;
    const prevClose3 = prevDay?.close3 ?? prevClose2;

    return {
      symbol,
      date,

      // ─── Price Features ──────────────────────────────────────────
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

      // ─── Volatility Features ──────────────────────────────────────
      atr14: this.atr(window, 14) / lastClose,
      realizedVolatility: this.realizedVolatility(closes),
      rollingStddev14: this.rollingStddev(closes, 14) / lastClose,
      rangeExpansion: (windowHigh - windowLow) / firstOpen,

      // ─── Volume Features ──────────────────────────────────────────
      cumulativeVolume: volumes.reduce((sum, v) => sum + v, 0),
      relativeVolume: prevDay && prevDay.averageMinVolume > 0
        ? volumes.reduce((sum, v) => sum + v, 0) / prevDay.averageMinVolume
        : 1,
      volumeSpike: this.volumeSpike(volumes),
      volumeTrend: this.linearSlope(volumes),

      // ─── Relative Historical Context Features (v2) ─────────────────
      prevReturn1: prevClose2 > 0 ? (prevClose1 - prevClose2) / prevClose2 : 0,
      prevReturn2: prevClose3 > 0 ? (prevClose2 - prevClose3) / prevClose3 : 0,
      prevTrend3d: prevClose3 > 0 ? (prevClose1 - prevClose3) / prevClose3 : 0,
      prevRange1: prevClose1 > 0 ? (prevHigh1 - prevLow1) / prevClose1 : 0,
      prevRange2: prevClose2 > 0 ? (prevHigh2 - prevLow2) / prevClose2 : 0,
      prevPosition1: (prevHigh1 - prevLow1) > 0
        ? (prevClose1 - prevLow1) / (prevHigh1 - prevLow1)
        : 0.5,
      prevPosition2: (prevHigh2 - prevLow2) > 0
        ? (prevClose2 - prevLow2) / (prevHigh2 - prevLow2)
        : 0.5,
      priceFromMA3: this.priceFromMA(lastClose, prevClose1, prevClose2, prevClose3),
      gapToRangeRatio: this.gapToRangeRatio(firstOpen, prevClose1, prevHigh1, prevLow1),

      // ─── Directional Momentum Features (v2) ────────────────────────
      rsiIntraday: this.rsi(closes, 14),
      buyingPressure: this.buyingPressure(window),
      volumeWeightedDirection: this.volumeWeightedDirection(window),
      priceAcceleration: this.priceAcceleration(closes),
      lastBarsStrength: this.lastBarsStrength(closes),
      intradayMomentumRatio: this.intradayMomentumRatio(closes),

      // ─── Time Features ────────────────────────────────────────────
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
      features.prevReturn1,
      features.prevReturn2,
      features.prevTrend3d,
      features.prevRange1,
      features.prevRange2,
      features.prevPosition1,
      features.prevPosition2,
      features.priceFromMA3,
      features.gapToRangeRatio,
      features.rsiIntraday,
      features.buyingPressure,
      features.volumeWeightedDirection,
      features.priceAcceleration,
      features.lastBarsStrength,
      features.intradayMomentumRatio,
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
      "prevReturn1",
      "prevReturn2",
      "prevTrend3d",
      "prevRange1",
      "prevRange2",
      "prevPosition1",
      "prevPosition2",
      "priceFromMA3",
      "gapToRangeRatio",
      "rsiIntraday",
      "buyingPressure",
      "volumeWeightedDirection",
      "priceAcceleration",
      "lastBarsStrength",
      "intradayMomentumRatio",
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
    return past > 0 ? (recent - past) / past : 0;
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
    return past > 0 ? (current - past) / past : 0;
  }

  private vwapDistance(candles: OHLCV[]): number {
    let cumulativeTPV = 0;
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

  // ─── Relative Historical Context Helpers (v2) ──────────────────────

  private priceFromMA(currentPrice: number, c1: number, c2: number, c3: number): number {
    const ma = (c1 + c2 + c3) / 3;
    return ma > 0 ? (currentPrice - ma) / ma : 0;
  }

  private gapToRangeRatio(todayOpen: number, prevClose: number, prevHigh: number, prevLow: number): number {
    const prevRange = prevHigh - prevLow;
    if (prevRange <= 0) return 0;
    const gap = todayOpen - prevClose;
    return gap / prevRange;
  }

  // ─── Directional Momentum Helpers (v2) ─────────────────────────────

  /**
   * Relative Strength Index (RSI) computed from candle closes.
   * 0-100 scale: >70 = overbought, <30 = oversold.
   */
  private rsi(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50; // neutral default

    let avgGain = 0;
    let avgLoss = 0;

    // Initial average
    for (let i = 1; i <= period; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) avgGain += change;
      else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    // Smoothed RSI using all remaining data
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

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  /**
   * Buying pressure: fraction of candles where close > open (bullish candles).
   * 0 = all bearish, 1 = all bullish.
   */
  private buyingPressure(candles: OHLCV[]): number {
    if (candles.length === 0) return 0.5;
    const bullish = candles.filter((c) => c.close > c.open).length;
    return bullish / candles.length;
  }

  /**
   * Volume-weighted direction: measures whether volume favors bulls or bears.
   * Range: [-1, 1]. Positive = volume concentrated in bullish candles.
   */
  private volumeWeightedDirection(candles: OHLCV[]): number {
    let totalVolume = 0;
    let dirVolume = 0;

    for (const c of candles) {
      totalVolume += c.volume;
      const sign = c.close > c.open ? 1 : c.close < c.open ? -1 : 0;
      dirVolume += c.volume * sign;
    }

    return totalVolume > 0 ? dirVolume / totalVolume : 0;
  }

  /**
   * Price acceleration: slope of rolling returns (is momentum speeding up?).
   * Positive = price is accelerating upward, negative = decelerating/reversing.
   */
  private priceAcceleration(closes: number[]): number {
    if (closes.length < 10) return 0;

    // Compute 5-period returns at various points
    const returns: number[] = [];
    for (let i = 5; i < closes.length; i++) {
      const ret = closes[i - 5] > 0 ? (closes[i] - closes[i - 5]) / closes[i - 5] : 0;
      returns.push(ret);
    }

    if (returns.length < 3) return 0;
    return this.linearSlope(returns);
  }

  /**
   * Last bars strength: compares return in last 1/3 of window vs first 1/3.
   * Positive = strengthening into close, negative = weakening.
   */
  private lastBarsStrength(closes: number[]): number {
    const n = closes.length;
    if (n < 6) return 0;

    const third = Math.floor(n / 3);
    const firstThirdReturn = closes[third - 1] > 0
      ? (closes[third - 1] - closes[0]) / closes[0]
      : 0;
    const lastThirdReturn = closes[n - third - 1] > 0
      ? (closes[n - 1] - closes[n - third - 1]) / closes[n - third - 1]
      : 0;

    return lastThirdReturn - firstThirdReturn;
  }

  /**
   * Intraday momentum ratio: avg(positive returns) / avg(|negative returns|).
   * >1 = bulls stronger than bears, <1 = bears stronger.
   * Normalized to [0, 2] range and centered at 1.
   */
  private intradayMomentumRatio(closes: number[]): number {
    const returns = this.simpleReturns(closes);
    if (returns.length === 0) return 1;

    const gains = returns.filter((r) => r > 0);
    const losses = returns.filter((r) => r < 0);

    const avgGain = gains.length > 0 ? gains.reduce((s, v) => s + v, 0) / gains.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, v) => s + v, 0) / losses.length) : 0;

    if (avgLoss === 0) return 2; // all gains, cap at 2
    const ratio = avgGain / avgLoss;
    return Math.min(ratio, 2); // cap at 2
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
      if (closes[i - 1] > 0 && closes[i] > 0) {
        returns.push(Math.log(closes[i] / closes[i - 1]));
      }
    }
    return returns;
  }

  private simpleReturns(closes: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) {
        returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
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
