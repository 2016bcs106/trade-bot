import "../config/env.ts";
import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import BaseScript from "./base-script.ts";
import { now, nowMs, nowFormatted } from "../utils/time.ts";
import TradingConfig from "../config/trading-config.ts";
import SmaCrossoverAnalyzer from "../features/sma-crossover-analyzer.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";
import { LiveMarketDataResponse } from "../types/market-data/live-market-data.ts";
import { AnalysisResult } from "../types/analysis/analysis-result.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OP_TIMEOUT_MS = 15000;

class TradeBotScript extends BaseScript {
  private config = new TradingConfig("trade-bot");
  private paytm = new PaytmMoneyClient();
  private analyzer = new SmaCrossoverAnalyzer(this.config);
  private ticksProcessed = 0;
  private signalsGenerated = 0;
  private running = false;
  private resetDone = false;

  get scriptName(): string {
    return "trade-bot";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      ticksProcessed: this.ticksProcessed,
      signalsGenerated: this.signalsGenerated,
      running: this.running,
      dryRun: this.config.dryRun,
      config: this.config.toJSON(),
    };
  }

  protected async run(): Promise<void> {
    if (!this.config.isValid) {
      TradingConfig.printHelp("trade-bot");
      process.exit(0);
    }

    this.log.info("Starting with config", this.config.toJSON());

    if (this.config.dryRun) {
      this.log.info("DRY RUN MODE — No data will be saved to Firebase");
      await this.startDryRun();
    } else {
      this.log.info("Listening for config/enabled...");

      this.firebase.onEnabledChange((enabled: boolean | null) => {
        if (enabled === true && !this.running) {
          this.log.info("Bot enabled — starting analysis loop");
          this.analyzer.reset();
          this.running = true;
        } else if (enabled === false && this.running) {
          this.log.info("Bot disabled — pausing analysis loop");
          this.running = false;
        } else if (enabled == null) {
          this.log.warn("Config not set — waiting for enabled flag");
        }
      });

      await this.startLive();
    }
  }

  private async startDryRun(): Promise<void> {
    const ohlcvData = await this.paytm.fetchOHLCV(this.config.pmlId!, this.config.fromDate!, this.config.toDate!);
    const testData = ohlcvData.map(c => ({ date: c.timestamp, close: c.close, volume: c.volume }));
    this.analyzer.reset();

    const ticks: Array<{ time: string; close: number; fastSma: number | null; slowSma: number | null }> = [];
    const signals: Array<{ time: string; signal: string; triggerPrice: number; gain: number; status: string }> = [];

    for (const point of testData) {
      const [, time] = point.date.split(" ");
      const analysis = this.analyzer.next(point);
      this.ticksProcessed++;

      ticks.push({ time, close: analysis.close, fastSma: analysis.fastSma, slowSma: analysis.slowSma });

      if (analysis.signal !== null) {
        this.signalsGenerated++;
        signals.push({ time, signal: analysis.signal, triggerPrice: analysis.close, gain: analysis.runningProfit, status: "DRY_RUN" });
      }
    }

    const outputPath = resolve(__dirname, "..", "..", "..", "frontend", "public", "dry-run-output.json");
    const output = { ticks, signals, generatedAt: nowFormatted() };
    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    this.log.info(`Processed ${testData.length} data points — output: ${outputPath}`);
    this.log.info(`Net gain: ${signals.slice(-1)[0]?.gain ?? 0}`);
  }

  private async startLive(): Promise<void> {
    let accessToken = await this.withTimeout(this.firebase.getAccessToken(), "getAccessToken");
    this.log.info("Access token loaded from Firebase");

    this.firebase.onAccessTokenChange((newToken: string) => {
      if (newToken !== accessToken) {
        this.log.info("Access token updated from Firebase");
        accessToken = newToken;
      }
    });

    this.log.info(`Entering main loop — operation timeout: ${OP_TIMEOUT_MS}ms`);

    while (true) {
      const startTime = nowMs();
      try {
        const date = now().format("YYYY-MM-DD");
        const time = now().format("HH:mm");

        if (time >= "09:15" && time <= "15:30") {
          const lastTradedPrice = await this.withTimeout(
            this.paytm.fetchLiveData(this.config.exchangeType, this.config.scripId, this.config.scripType, accessToken),
            "fetchLiveData",
          );
          const price = this.extractLtp(lastTradedPrice);
          const analysis: AnalysisResult = this.analyzer.next({ date: `${date} ${time}`, close: price });
          this.ticksProcessed++;

          await this.withTimeout(
            this.firebase.storeTick(date, { time, close: analysis.close, fastSma: analysis.fastSma, slowSma: analysis.slowSma }),
            "storeTick",
          );

          if (this.running) {
            this.log.debug(`Tick processed — time=${time} price=${price} fastSma=${analysis.fastSma} slowSma=${analysis.slowSma}`);
            if (analysis.signal !== null) {
              this.signalsGenerated++;
              this.log.info(`Signal generated: ${analysis.signal} @ ${price} | gain=${analysis.runningProfit}`);
              await this.withTimeout(
                this.firebase.storeSignal(date, { time, signal: analysis.signal, triggerPrice: price, gain: analysis.runningProfit, status: "DRY_RUN" }),
                "storeSignal",
              );
            }
          } else {
            this.log.debug(`Tick stored but bot paused — time=${time}`);
          }
        } else if (time >= "09:00" && time <= "09:14") {
          if (!this.resetDone) {
            this.log.info("Pre-market reset — clearing ticks and signals");
            await this.withTimeout(this.firebase.clearTicks(), "clearTicks");
            await this.withTimeout(this.firebase.clearSignals(), "clearSignals");
            this.analyzer.reset();
            this.resetDone = true;
            this.log.info("Pre-market reset complete");
          }
        } else {
          this.resetDone = false;
          this.log.debug(`Outside market hours — time=${time}`);
        }
      } catch (error) {
        this.log.error("Loop error", error);
      }

      const elapsedTime = nowMs() - startTime;
      const waitTime = 60000 - elapsedTime;
      await this.wait(Math.max(0, waitTime));
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${OP_TIMEOUT_MS}ms`)), OP_TIMEOUT_MS),
      ),
    ]);
  }

  private extractLtp(response: LiveMarketDataResponse): number {
    const price = response?.data?.[0]?.last_price;
    if (typeof price !== "number" || Number.isNaN(price)) {
      throw new Error(`Invalid live data response: ${JSON.stringify(response)}`);
    }
    return price;
  }
}

new TradeBotScript().start();
