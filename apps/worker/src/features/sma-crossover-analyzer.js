import SimpleMovingAverage from "./simple-moving-average.js";
import CrossoverSignalGenerator from "../prediction/crossover-signal-generator.js";

export default class SmaCrossoverAnalyzer {
  constructor(config) {
    this.fastSmaSmoother = new SimpleMovingAverage(config.fastSmaPeriod);
    this.slowSmaSmoother = new SimpleMovingAverage(config.slowSmaPeriod);
    this.signalGenerator = new CrossoverSignalGenerator(
      config.cooldownWindow,
      config.sidewaysWindow,
      config.volatilityWindow,
      config.maxVolatilityRangePercent,
      config.sidewaysThresholdPercent,
    );

    this.currentDay = null;
    this.previousSlowSma = null;
  }

  reset() {
    this.currentDay = null;
    this.previousSlowSma = null;
    this.fastSmaSmoother.reset();
    this.slowSmaSmoother.reset();
    this.signalGenerator.reset();
  }

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
