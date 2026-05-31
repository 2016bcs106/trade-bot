export interface SignalOutput {
  signal: string | null;
  units: number;
  netUnits: number;
  sideways: boolean;
  runningProfit: number;
}

export default class CrossoverSignalGenerator {
  private cooldownWindow: number;
  private sidewaysWindow: number;
  private sidewaysThresholdPercent: number;
  private volatilityWindow: number;
  private maxVolatilityRangePercent: number;

  private data: (number | null)[];
  private executionPrices: number[];
  private lastAction: string | null;
  private index: number;
  private lastTradeIndex: number;
  private positionQty: number;
  private avgEntryPrice: number | null;
  private runningProfit: number;
  private netUnits: number;
  private tradeCount: number;

  constructor(
    cooldownWindow: number,
    sidewaysWindow: number,
    volatilityWindow: number,
    maxVolatilityRangePercent: number,
    sidewaysThresholdPercent: number,
  ) {
    this.cooldownWindow = cooldownWindow;
    this.sidewaysWindow = sidewaysWindow;
    this.sidewaysThresholdPercent = sidewaysThresholdPercent;
    this.volatilityWindow = volatilityWindow;
    this.maxVolatilityRangePercent = maxVolatilityRangePercent;
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

  reset(): void {
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

  applyTrade(tradeQty: number, tradePrice: number): void {
    if (tradeQty === 0) return;

    if (this.positionQty === 0) {
      this.positionQty = tradeQty;
      this.avgEntryPrice = tradePrice;
      this.netUnits = this.positionQty;
      return;
    }

    const sameDirection = this.positionQty * tradeQty > 0;

    if (sameDirection) {
      const totalQty = Math.abs(this.positionQty) + Math.abs(tradeQty);
      this.avgEntryPrice =
        ((this.avgEntryPrice! * Math.abs(this.positionQty)) +
          tradePrice * Math.abs(tradeQty)) /
        totalQty;

      this.positionQty += tradeQty;
      this.netUnits = this.positionQty;
      return;
    }

    const closeQty = Math.min(Math.abs(this.positionQty), Math.abs(tradeQty));
    const positionSign = Math.sign(this.positionQty);

    const realizedProfit = closeQty * (tradePrice - this.avgEntryPrice!) * positionSign;
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

  generate(
    value: number | null,
    previousSlowSma: number | null,
    slowSma: number | null,
    time: string,
    executionPrice: number,
  ): SignalOutput {
    let signal: string | null = null;
    let units = 1;

    const tradingEnabled = time >= "09:30" && time <= "15:15";
    const canTrade = this.index - this.lastTradeIndex >= this.cooldownWindow;

    // Sideways Detection
    const start = Math.max(0, this.data.length - this.sidewaysWindow + 1);
    const window = this.data.slice(start).filter((v): v is number => v !== null);
    if (value !== null) window.push(value);

    const maxPrice = Math.max(...window);
    const minPrice = Math.min(...window);
    const rangePercent = minPrice !== 0 ? ((maxPrice - minPrice) / minPrice) * 100 : 0;
    const isSideways = rangePercent < this.sidewaysThresholdPercent;

    // Volatility Guard
    const volatilityStart = Math.max(0, this.executionPrices.length - this.volatilityWindow + 1);
    const volatilityWindowPrices = this.executionPrices.slice(volatilityStart);
    volatilityWindowPrices.push(executionPrice);

    const maxVolatilityPrice = Math.max(...volatilityWindowPrices);
    const minVolatilityPrice = Math.min(...volatilityWindowPrices);
    const volatilityRangePercent =
      minVolatilityPrice !== 0
        ? ((maxVolatilityPrice - minVolatilityPrice) / minVolatilityPrice) * 100
        : 0;
    const isTooVolatile = volatilityRangePercent > this.maxVolatilityRangePercent;

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

      const crossedAbove = previousClose !== null && previousClose <= previousSlowSma && value > slowSma;
      const crossedBelow = previousClose !== null && previousClose >= previousSlowSma && value < slowSma;

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
