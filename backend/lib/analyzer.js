import { SimpleMovingAverage } from "./sma.js";
import { SimpleSignalGenerator } from "./simple-signal-generator.js";

export class Analyzer {
  constructor(config) {
    this.fastSmaSmoother = new SimpleMovingAverage(config.fastSmaPeriod);
    this.slowSmaSmoother = new SimpleMovingAverage(config.slowSmaPeriod);
    this.signalGenerator = new SimpleSignalGenerator();

    this.currentDay = null;
  }

  reset() {
    this.currentDay = null;
    this.fastSmaSmoother.reset();
    this.slowSmaSmoother.reset();
    this.signalGenerator.reset();
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
    }

    const slowSma = this.slowSmaSmoother.compute(point.close);
    const fastSma = this.fastSmaSmoother.compute(point.close);

    // Peak/trough detection on 5-min intervals, reversal on every tick
    const minute = parseInt(time.split(":")[1], 10);
    const isExtremaTick = minute % 5 === 0;

    const { signal, runningProfit } = this.signalGenerator.generate(
      point.close,
      isExtremaTick,
    );

    return {
      date: point.date,
      close: point.close,
      fastSma,
      slowSma,
      signal,
      runningProfit,
    };
  }
}
