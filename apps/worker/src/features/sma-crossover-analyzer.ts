import SimpleMovingAverage from "./simple-moving-average.ts";
import CrossoverSignalGenerator from "../prediction/crossover-signal-generator.ts";
import { AnalysisResult } from "../types/analysis-result.ts";
import TradingConfig from "../config/trading-config.ts";

interface DataPoint {
  date: string;
  close: number;
}

export default class SmaCrossoverAnalyzer {
  private fastSmaSmoother: SimpleMovingAverage;
  private slowSmaSmoother: SimpleMovingAverage;
  private signalGenerator: CrossoverSignalGenerator;
  private currentDay: string | null;
  private previousSlowSma: number | null;

  constructor(config: TradingConfig) {
    this.fastSmaSmoother = new SimpleMovingAverage(config.fastSmaPeriod!);
    this.slowSmaSmoother = new SimpleMovingAverage(config.slowSmaPeriod!);
    this.signalGenerator = new CrossoverSignalGenerator(
      config.cooldownWindow!,
      config.sidewaysWindow!,
      config.volatilityWindow!,
      config.maxVolatilityRangePercent!,
      config.sidewaysThresholdPercent!,
    );

    this.currentDay = null;
    this.previousSlowSma = null;
  }

  reset(): void {
    this.currentDay = null;
    this.previousSlowSma = null;
    this.fastSmaSmoother.reset();
    this.slowSmaSmoother.reset();
    this.signalGenerator.reset();
  }

  next(point: DataPoint): AnalysisResult {
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

    const { signal, runningProfit } = this.signalGenerator.generate(
      fastSma,
      this.previousSlowSma,
      slowSma,
      time,
      point.close,
    );

    this.previousSlowSma = slowSma;

    return {
      close: point.close,
      fastSma,
      slowSma,
      signal,
      runningProfit,
    };
  }
}
