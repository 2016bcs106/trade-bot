export class SignalGenerator {
  constructor(
    cooldownWindow = 1,
    sidewaysWindow = 5,
    volatilityWindow = 5,
    maxVolatilityRangePercent = 0.3,
    sidewaysThresholdPercent = 0.0
  ) {
    this.cooldownWindow = cooldownWindow;
    this.sidewaysWindow = sidewaysWindow;
    this.sidewaysThresholdPercent = sidewaysThresholdPercent;
    this.volatilityWindow = volatilityWindow;
    this.maxVolatilityRangePercent = maxVolatilityRangePercent;
    this.reset();
  }

  reset() {
    this.data = [];
    this.executionPrices = [];
    this.lastAction = null;
    this.index = 0;
    this.lastTradeIndex = -this.cooldownWindow;
    this.positionQty = 0;
    this.avgEntryPrice = null;
    this.runningProfit = 0;
    this.netUnits = 0;
    this.tradeCount = 0;
  }

  applyTrade(tradeQty, tradePrice) {
    if (tradeQty === 0) {
      return;
    }

    // Open new position
    if (this.positionQty === 0) {
      this.positionQty = tradeQty;
      this.avgEntryPrice = tradePrice;
      this.netUnits = this.positionQty;
      return;
    }

    const sameDirection = this.positionQty * tradeQty > 0;

    // Add on same side with weighted average
    if (sameDirection) {
      const totalQty = Math.abs(this.positionQty) + Math.abs(tradeQty);
      this.avgEntryPrice =
        ((this.avgEntryPrice * Math.abs(this.positionQty)) +
          tradePrice * Math.abs(tradeQty)) /
        totalQty;

      this.positionQty += tradeQty;
      this.netUnits = this.positionQty;
      return;
    }

    // Opposite side: close existing qty, maybe flip
    const closeQty = Math.min(Math.abs(this.positionQty), Math.abs(tradeQty));
    const positionSign = Math.sign(this.positionQty);

    const realizedProfit = closeQty * (tradePrice - this.avgEntryPrice) * positionSign;
    this.runningProfit += realizedProfit;

    const remainingTradeQty = Math.abs(tradeQty) - closeQty;

    if (remainingTradeQty === 0) {
      this.positionQty += tradeQty;

      if (this.positionQty === 0) {
        this.avgEntryPrice = null;
      }
    } else {
      this.positionQty = Math.sign(tradeQty) * remainingTradeQty;
      this.avgEntryPrice = tradePrice;
    }

    this.netUnits = this.positionQty;
  }

  generate(value, previousSlowSma, slowSma, time, executionPrice = value) {
    let signal = null;
    let units = 1;

    // Trading Window
    const tradingEnabled = time >= "09:30" && time <= "15:15";

    // Cooldown
    const canTrade = this.index - this.lastTradeIndex >= this.cooldownWindow;

    // Sideways Detection
    const start = Math.max(0, this.data.length - this.sidewaysWindow + 1);
    const window = this.data.slice(start);
    window.push(value);

    const maxPrice = Math.max(...window);
    const minPrice = Math.min(...window);
    const rangePercent = ((maxPrice - minPrice) / minPrice) * 100;
    const isSideways = rangePercent < this.sidewaysThresholdPercent;

    // Volatility Guard
    const volatilityStart = Math.max(
      0,
      this.executionPrices.length - this.volatilityWindow + 1,
    );
    const volatilityWindowPrices = this.executionPrices.slice(volatilityStart);
    volatilityWindowPrices.push(executionPrice);

    const maxVolatilityPrice = Math.max(...volatilityWindowPrices);
    const minVolatilityPrice = Math.min(...volatilityWindowPrices);
    const volatilityRangePercent =
      ((maxVolatilityPrice - minVolatilityPrice) / minVolatilityPrice) * 100;
    const isTooVolatile =
      volatilityRangePercent > this.maxVolatilityRangePercent;

    // Force Square Off
    if (time >= "15:14" && this.netUnits !== 0) {
      signal = this.netUnits > 0 ? "SELL" : "BUY";
      units = Math.abs(this.netUnits);

      const squareOffQty = this.netUnits > 0 ? -units : units;
      this.applyTrade(squareOffQty, executionPrice);

      this.lastAction = signal;
      this.lastTradeIndex = this.index;
    }

    // Signal Logic
    else if (tradingEnabled && canTrade && this.index > 1 && !isSideways && !isTooVolatile && value !== null && slowSma !== null && previousSlowSma !== null) {
      const previousClose = this.data[this.index - 1];

      // BUY: fast SMA crosses ABOVE slow SMA
      const crossedAbove = previousClose <= previousSlowSma && value > slowSma;

      // SELL: fast SMA crosses BELOW slow SMA
      const crossedBelow = previousClose >= previousSlowSma && value < slowSma;

      // Units: first trade => 1, subsequent trades => 2
      units = this.tradeCount === 0 ? 1 : 2;

      if (crossedAbove && this.lastAction !== "BUY") {
        signal = "BUY";
        this.applyTrade(units, executionPrice);
        this.lastAction = "BUY";
        this.lastTradeIndex = this.index;
        this.tradeCount++;
      } else if (crossedBelow && this.lastAction === "BUY") {
        signal = "SELL";
        this.applyTrade(-units, executionPrice);
        this.lastAction = "SELL";
        this.lastTradeIndex = this.index;
        this.tradeCount++;
      }
    }

    // Store Current Value
    this.data.push(value);
    this.executionPrices.push(executionPrice);
    this.index++;

    return {
      signal,
      units,
      netUnits: this.netUnits,
      sideways: isSideways,
      runningProfit: Number(this.runningProfit.toFixed(2)),
    };
  }
}
