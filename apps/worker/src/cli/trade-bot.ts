import "../config/env.ts";
import BaseScript from "./base-script.ts";
import { now, nowMs } from "../utils/time.ts";
import TradingConfig from "../config/trading-config.ts";
import SmaCrossoverAnalyzer from "../features/sma-crossover-analyzer.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";
import { LiveMarketDataResponse } from "../types/market-data/live-market-data.ts";
import { StockConfig } from "../types/stocks/stock-config.ts";

/** Shared default config for all SMA analyzers */
const DEFAULT_CONFIG = new TradingConfig("trade-bot");

const OP_TIMEOUT_MS = 15000;

/**
 * Per-stock tracking state.
 */
interface StockTracker {
  config: StockConfig;
  analyzer: SmaCrossoverAnalyzer;
}

/**
 * Trade Bot — tracks ALL enabled stocks from Firebase.
 *
 * Every minute during market hours (9:15-15:30 IST):
 * - Fetches live price for each enabled stock
 * - Runs SMA crossover analysis
 * - Stores ticks at prices/{symbol}/ and signals at signals/{symbol}/
 *
 * Pre-market (9:00-9:14): clears previous day's ticks/signals for all stocks.
 */
class TradeBotScript extends BaseScript {
  private paytm = new PaytmMoneyClient();
  private trackers = new Map<string, StockTracker>();
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
      trackedStocks: [...this.trackers.keys()],
    };
  }

  protected async run(): Promise<void> {
    // Load enabled stocks
    const allStocks = await this.firebase.getAllStocks();
    const enabledStocks = Object.values(allStocks).filter((s) => s.enabled);

    if (enabledStocks.length === 0) {
      this.log.error("No enabled stocks found — nothing to track");
      process.exit(1);
    }

    // Create a tracker per stock
    for (const stock of enabledStocks) {
      this.trackers.set(stock.symbol, {
        config: stock,
        analyzer: new SmaCrossoverAnalyzer(DEFAULT_CONFIG),
      });
    }

    this.log.info(`Tracking ${enabledStocks.length} stocks: ${enabledStocks.map((s) => s.symbol).join(", ")}`);

    // Listen for enabled flag
    this.firebase.onEnabledChange((enabled: boolean | null) => {
      if (enabled === true && !this.running) {
        this.log.info("Bot enabled — starting analysis");
        for (const tracker of this.trackers.values()) tracker.analyzer.reset();
        this.running = true;
      } else if (enabled === false && this.running) {
        this.log.info("Bot disabled — pausing");
        this.running = false;
      } else if (enabled == null) {
        this.log.warn("Config not set — waiting for enabled flag");
      }
    });

    // Get access token
    let accessToken = await this.withTimeout(this.firebase.getAccessToken(), "getAccessToken");
    this.log.info("Access token loaded");

    this.firebase.onAccessTokenChange((newToken: string) => {
      if (newToken !== accessToken) {
        this.log.info("Access token updated");
        accessToken = newToken;
      }
    });

    this.log.info("Entering main loop");

    while (true) {
      const startTime = nowMs();
      try {
        const date = now().format("YYYY-MM-DD");
        const time = now().format("HH:mm");

        if (time >= "09:15" && time <= "15:30") {
          await this.processAllStocks(date, time, accessToken);
        } else if (time >= "09:00" && time <= "09:14") {
          if (!this.resetDone) {
            this.log.info("Pre-market reset — clearing ticks and signals for all stocks");
            for (const symbol of this.trackers.keys()) {
              await this.withTimeout(this.firebase.clearTicks(symbol), `clearTicks:${symbol}`);
              await this.withTimeout(this.firebase.clearSignals(symbol), `clearSignals:${symbol}`);
            }
            for (const tracker of this.trackers.values()) tracker.analyzer.reset();
            this.resetDone = true;
            this.log.info("Pre-market reset complete");
          }
        } else {
          this.resetDone = false;
        }
      } catch (error) {
        this.log.error("Loop error", error);
      }

      const elapsedTime = nowMs() - startTime;
      const waitTime = 60000 - elapsedTime;
      await this.wait(Math.max(0, waitTime));
    }
  }

  /**
   * Fetch live price and run analysis for all tracked stocks.
   */
  private async processAllStocks(date: string, time: string, accessToken: string): Promise<void> {
    for (const [symbol, tracker] of this.trackers) {
      try {
        const { config } = tracker;
        const scripId = String(config.securityId);
        const exchangeType = config.exchange || "NSE";

        const liveData = await this.withTimeout(
          this.paytm.fetchLiveData(exchangeType, scripId, "ES", accessToken),
          `fetchLiveData:${symbol}`,
        );
        const price = this.extractLtp(liveData);
        const analysis = tracker.analyzer.next({ date: `${date} ${time}`, close: price });
        this.ticksProcessed++;

        await this.withTimeout(
          this.firebase.storeTick(symbol, date, { time, close: analysis.close, fastSma: analysis.fastSma, slowSma: analysis.slowSma }),
          `storeTick:${symbol}`,
        );

        if (this.running && analysis.signal !== null) {
          this.signalsGenerated++;
          this.log.info(`Signal [${symbol}]: ${analysis.signal} @ ${price} | gain=${analysis.runningProfit}`);
          await this.withTimeout(
            this.firebase.storeSignal(symbol, date, { time, signal: analysis.signal, triggerPrice: price, gain: analysis.runningProfit, status: "LIVE" }),
            `storeSignal:${symbol}`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`Error processing ${symbol}: ${msg}`);
      }
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
