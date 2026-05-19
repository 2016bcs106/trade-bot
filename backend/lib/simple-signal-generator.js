/**
 * A reversal-based signal generator using local extrema.
 * - Detects local peaks and troughs on 5-min intervals.
 * - After a trough: tracks the running high on 5-min data. SELL when 1-min price
 *   drops reversalPercent% from that running high (range = runningHigh - trough).
 * - After a peak: tracks the running low on 5-min data. BUY when 1-min price
 *   rises reversalPercent% from that running low (range = peak - runningLow).
 */
export class SimpleSignalGenerator {
  constructor({ reversalPercent = 20 } = {}) {
    this.reversalPercent = reversalPercent / 100;
    this.reset();
  }

  reset() {
    this.lastAction = null;
    this.previousExtremaPrice = null; // last price on a 5-min tick
    this.direction = null; // 'up' or 'down' (5-min scale)
    this.lastConfirmedExtreme = null; // 'peak' or 'trough'
    this.confirmedPeak = null; // value of last confirmed peak
    this.confirmedTrough = null; // value of last confirmed trough
    this.runningHighSinceTrough = null; // highest 5-min price since trough
    this.runningLowSincePeak = null; // lowest 5-min price since peak
    this.positionQty = 0;
    this.avgEntryPrice = null;
    this.runningProfit = 0;
  }

  /**
   * Generate a signal based on local extrema reversal.
   * @param {number} price - The actual current price (1-min)
   * @param {boolean} isExtremaTick - Whether this tick updates peak/trough detection (5-min)
   * @returns {{ signal: string|null, runningProfit: number }}
   */
  generate(price, isExtremaTick = false) {
    let signal = null;

    // Update peak/trough detection and running extremes on 5-min ticks
    if (isExtremaTick) {
      if (this.previousExtremaPrice === null) {
        this.previousExtremaPrice = price;
      } else {
        if (price > this.previousExtremaPrice) {
          // Rising on 5-min scale
          if (this.direction === "down") {
            // Direction changed: down → up → confirm trough
            this.confirmedTrough = this.previousExtremaPrice;
            this.lastConfirmedExtreme = "trough";
            this.runningHighSinceTrough = price;
          }
          this.direction = "up";
          // Update running high since last trough
          if (this.lastConfirmedExtreme === "trough" && this.runningHighSinceTrough !== null) {
            this.runningHighSinceTrough = Math.max(this.runningHighSinceTrough, price);
          }
        } else if (price < this.previousExtremaPrice) {
          // Falling on 5-min scale
          if (this.direction === "up") {
            // Direction changed: up → down → confirm peak
            this.confirmedPeak = this.previousExtremaPrice;
            this.lastConfirmedExtreme = "peak";
            this.runningLowSincePeak = price;
          }
          this.direction = "down";
          // Update running low since last peak
          if (this.lastConfirmedExtreme === "peak" && this.runningLowSincePeak !== null) {
            this.runningLowSincePeak = Math.min(this.runningLowSincePeak, price);
          }
        }
        this.previousExtremaPrice = price;
      }
    }

    // Check for reversal signals on every 1-min tick
    // After trough confirmed → price rallied to runningHigh → SELL on 20% drop from runningHigh
    if (this.lastConfirmedExtreme === "trough" &&
        this.confirmedTrough !== null &&
        this.runningHighSinceTrough !== null &&
        this.lastAction !== "SELL") {
      const range = this.runningHighSinceTrough - this.confirmedTrough;
      if (range > 0) {
        const sellThreshold = this.runningHighSinceTrough - this.reversalPercent * range;
        if (price <= sellThreshold) {
          signal = "SELL";
          this.applyTrade(-1, price);
          this.lastAction = "SELL";
        }
      }
    }

    // After peak confirmed → price dropped to runningLow → BUY on 20% bounce from runningLow
    if (signal === null &&
        this.lastConfirmedExtreme === "peak" &&
        this.confirmedPeak !== null &&
        this.runningLowSincePeak !== null &&
        this.lastAction !== "BUY") {
      const range = this.confirmedPeak - this.runningLowSincePeak;
      if (range > 0) {
        const buyThreshold = this.runningLowSincePeak + this.reversalPercent * range;
        if (price >= buyThreshold) {
          signal = "BUY";
          this.applyTrade(1, price);
          this.lastAction = "BUY";
        }
      }
    }

    return {
      signal,
      runningProfit: Number(this.runningProfit.toFixed(2)),
    };
  }

  /** @private */
  applyTrade(qty, price) {
    if (this.positionQty === 0) {
      this.positionQty = qty;
      this.avgEntryPrice = price;
      return;
    }

    const sameDirection = this.positionQty * qty > 0;

    if (sameDirection) {
      const totalQty = Math.abs(this.positionQty) + Math.abs(qty);
      this.avgEntryPrice =
        (this.avgEntryPrice * Math.abs(this.positionQty) +
          price * Math.abs(qty)) /
        totalQty;
      this.positionQty += qty;
      return;
    }

    // Opposite side: realize profit/loss
    const closeQty = Math.min(Math.abs(this.positionQty), Math.abs(qty));
    const positionSign = Math.sign(this.positionQty);
    this.runningProfit +=
      closeQty * (price - this.avgEntryPrice) * positionSign;

    const remaining = Math.abs(qty) - closeQty;

    if (remaining === 0) {
      this.positionQty += qty;
      if (this.positionQty === 0) {
        this.avgEntryPrice = null;
      }
    } else {
      this.positionQty = Math.sign(qty) * remaining;
      this.avgEntryPrice = price;
    }
  }
}
