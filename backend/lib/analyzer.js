import { SimpleMovingAverage } from "./sma.js";
import { SignalGenerator } from "./signal-generator.js";

export class Analyzer {
  constructor(config) {
    this.fastSmaSmoother = new SimpleMovingAverage(config.fastSmaPeriod);
    this.slowSmaSmoother = new SimpleMovingAverage(config.slowSmaPeriod);
    this.signalGenerator = new SignalGenerator(
      config.cooldownWindow,
      config.sidewaysWindow,
      config.volatilityWindow,
      config.maxVolatilityRangePercent,
      config.sidewaysThresholdPercent,
    );

    this.currentDay = null;
    this.previousSlowSma = null;
  }

  /**
   * Process a single data point in real-time.
   * @param {{ date: string, close: number }} point
   * @returns {object} analysis result for this point
   */
  next(point) {
    const [day, time] = point.date.split(" ");

    if (day !== this.currentDay) {
      this.currentDay = day;
      this.fastSmaSmoother.reset();
      this.slowSmaSmoother.reset();
      this.signalGenerator.reset();
      this.previousSlowSma = null;
    }

    const slowSma = this.slowSmaSmoother.compute(point.close);
    const fastSma = this.fastSmaSmoother.compute(point.close);

    const { signal, units, runningProfit } = this.signalGenerator.generate(
      fastSma,
      this.previousSlowSma,
      slowSma,
      time,
      point.close,
    );

    this.previousSlowSma = slowSma;

    return {
      date: point.date,
      close: point.close,
      fastSma,
      slowSma,
      signal,
      units,
      runningProfit,
    };
  }
}
