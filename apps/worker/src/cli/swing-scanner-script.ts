import "../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { readdirSync, readFileSync } from "fs";
import BaseScript from "./base-script.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OHLCV_DIR = resolve(__dirname, "..", "..", "..", "..", "data", "daily-ohlcv");

const CONSOLIDATION_DAYS = 10;
const ATR_PERIOD = 20;
const VOLUME_SPIKE_THRESHOLD = 2.0;
const CONSOLIDATION_TIGHTNESS = 0.5;
const MA_PERIOD = 50;

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ScanResult {
  symbol: string;
  price: number;
  breakoutPercent: number;
  volumeRatio: number;
  consolidationRange: number;
  stopLoss: number;
  riskPercent: number;
}

class SwingScannerScript extends BaseScript {
  private results: ScanResult[] = [];
  private scannedCount = 0;
  private skippedCount = 0;

  get scriptName(): string {
    return "swing-scanner";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      "Scanned": this.scannedCount,
      "Skipped": this.skippedCount,
      "Signals found": this.results.length,
    };
  }

  protected async run(): Promise<void> {
    this.log.info("Running swing breakout scanner...");

    const files = readdirSync(OHLCV_DIR).filter((f) => f.endsWith(".json"));
    this.log.info(`Found ${files.length} stock files`);

    for (const file of files) {
      const symbol = file.replace(".json", "");
      try {
        const candles = this.loadCandles(file);
        if (candles.length < MA_PERIOD + CONSOLIDATION_DAYS) {
          this.skippedCount++;
          continue;
        }

        const result = this.scan(symbol, candles);
        if (result) {
          this.results.push(result);
        }
        this.scannedCount++;
      } catch {
        this.skippedCount++;
      }
    }

    this.results.sort((a, b) => b.volumeRatio - a.volumeRatio);

    this.log.info(`\n${"═".repeat(80)}`);
    this.log.info(`SWING BREAKOUT SIGNALS — ${this.results.length} found`);
    this.log.info(`${"═".repeat(80)}`);

    if (this.results.length === 0) {
      this.log.info("No breakout signals today.");
    } else {
      for (const r of this.results) {
        this.log.info(
          `${r.symbol.padEnd(15)} ` +
          `Price: ${r.price.toFixed(2).padStart(8)} | ` +
          `Breakout: +${r.breakoutPercent.toFixed(1)}% | ` +
          `Volume: ${r.volumeRatio.toFixed(1)}x | ` +
          `Stop: ${r.stopLoss.toFixed(2)} (${r.riskPercent.toFixed(1)}% risk)`
        );
      }
    }

    this.log.info(`\nScanned: ${this.scannedCount} | Skipped: ${this.skippedCount} | Signals: ${this.results.length}`);
  }

  private scan(symbol: string, candles: Candle[]): ScanResult | null {
    const latest = candles[candles.length - 1];
    const prev = candles.slice(-CONSOLIDATION_DAYS - 1, -1);

    // 1. Trend filter: price above 50-day MA
    const ma50 = this.sma(candles.slice(-MA_PERIOD).map((c) => c.close));
    if (latest.close < ma50) return null;

    // 2. Consolidation check: tight range over last N days
    const consolidationHigh = Math.max(...prev.map((c) => c.high));
    const consolidationLow = Math.min(...prev.map((c) => c.low));
    const consolidationRange = (consolidationHigh - consolidationLow) / consolidationLow;

    const atrCandles = candles.slice(-(ATR_PERIOD + CONSOLIDATION_DAYS), -CONSOLIDATION_DAYS);
    const avgRange = this.averageTrueRange(atrCandles);
    const avgRangePercent = avgRange / latest.close;

    if (consolidationRange > avgRangePercent * CONSOLIDATION_DAYS * CONSOLIDATION_TIGHTNESS) return null;

    // 3. Breakout: close above consolidation high
    if (latest.close <= consolidationHigh) return null;

    // 4. Volume spike: today's volume > 2x average
    const avgVolume = this.sma(candles.slice(-ATR_PERIOD - 1, -1).map((c) => c.volume));
    const volumeRatio = latest.volume / avgVolume;
    if (volumeRatio < VOLUME_SPIKE_THRESHOLD) return null;

    // Calculate stop loss and risk
    const stopLoss = consolidationLow;
    const riskPercent = ((latest.close - stopLoss) / latest.close) * 100;
    const breakoutPercent = ((latest.close - consolidationHigh) / consolidationHigh) * 100;

    return {
      symbol,
      price: latest.close,
      breakoutPercent,
      volumeRatio,
      consolidationRange: consolidationRange * 100,
      stopLoss,
      riskPercent,
    };
  }

  private loadCandles(file: string): Candle[] {
    const content = readFileSync(resolve(OHLCV_DIR, file), "utf-8");
    return JSON.parse(content) as Candle[];
  }

  private sma(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  private averageTrueRange(candles: Candle[]): number {
    let sum = 0;
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      sum += tr;
    }
    return sum / (candles.length - 1);
  }
}

new SwingScannerScript().start();
