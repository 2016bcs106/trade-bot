import { SimpleMovingAverage } from "./sma.js";
import { SignalGenerator } from "./signal-generator.js";

export class Analyzer {
  constructor(config = {}) {
    this.cooldownWindow = config.cooldownWindow ?? 1;
    this.fastSmaPeriod = config.fastSmaPeriod ?? 7;
    this.slowSmaPeriod = config.slowSmaPeriod ?? 55;
    this.sidewaysWindow = config.sidewaysWindow ?? 5;
    this.sidewaysThresholdPercent = config.sidewaysThresholdPercent ?? 0;
    this.volatilityWindow = config.volatilityWindow ?? 5;
    this.maxVolatilityRangePercent = config.maxVolatilityRangePercent ?? 100;
  }

  analyze(data) {
    let currentDay = null;
    const slowSmaValues = [];

    const fastSmaSmoother = new SimpleMovingAverage(this.fastSmaPeriod);
    const slowSmaSmoother = new SimpleMovingAverage(this.slowSmaPeriod);
    const signalGenerator = new SignalGenerator(
      this.cooldownWindow,
      this.sidewaysWindow,
      this.volatilityWindow,
      this.maxVolatilityRangePercent,
      this.sidewaysThresholdPercent,
    );

    return data.map((point, index) => {
      const [day, time] = point.date.split(" ");

      if (day !== currentDay) {
        currentDay = day;
        fastSmaSmoother.reset();
        slowSmaSmoother.reset();
        signalGenerator.reset();
      }

      let slowSma = slowSmaSmoother.compute(point.close);
      let fastSma = fastSmaSmoother.compute(point.close);

      let { signal, units, runningProfit } = signalGenerator.generate(
        fastSma,
        slowSmaValues[slowSmaValues.length - 1],
        slowSma,
        time,
        point.close,
      );

      slowSmaValues.push(slowSma);

      return {
        date: point.date,
        values: [
          {
            label: "Close",
            value: point.close,
            runningProfit: runningProfit,
            signal: signal,
            color: "#8fb3ff",
            enabled: false,
          },
          {
            label: "SlowSMA",
            value: slowSma,
            runningProfit: runningProfit,
            signal: signal,
            color: "#7ee0b5",
            enabled: true,
          },
          {
            label: "FastSMA",
            value: fastSma,
            runningProfit: runningProfit,
            signal: signal,
            color: "#b79cff",
            enabled: true,
          },
        ],
      };
    });
  }
}
