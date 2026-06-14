import "../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, writeFileSync } from "fs";
import moment from "moment";
import BaseScript from "./base-script.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";
import { StockConfig } from "../types/stocks/stock-config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "..", "..", "..", "..", "data", "daily-ohlcv");

const DEFAULT_LOOKBACK_DAYS = 3650;
const DELAY_BETWEEN_REQUESTS_MS = 500;

class FetchDailyOhlcvScript extends BaseScript {
  private client = new PaytmMoneyClient();
  private fetchedCount = 0;
  private skippedCount = 0;
  private errorCount = 0;

  get scriptName(): string {
    return "fetch-daily-ohlcv";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      "Fetched": this.fetchedCount,
      "Skipped": this.skippedCount,
      "Errors": this.errorCount,
    };
  }

  protected async run(): Promise<void> {
    mkdirSync(OUTPUT_DIR, { recursive: true });

    const pmlIdArg = process.argv.find((a) => a.startsWith("--pmlId="));
    const symbolArg = process.argv.find((a) => a.startsWith("--symbol="));
    const daysArg = process.argv.find((a) => /^\d+$/.test(a));
    const lookbackDays = daysArg ? parseInt(daysArg, 10) : DEFAULT_LOOKBACK_DAYS;
    const toDate = moment().utcOffset("+05:30").format("YYYY-MM-DD");
    const fromDate = moment().utcOffset("+05:30").subtract(lookbackDays, "days").format("YYYY-MM-DD");

    if (pmlIdArg && symbolArg) {
      const pmlId = pmlIdArg.split("=")[1];
      const symbol = symbolArg.split("=")[1];
      this.log.info(`Fetching ${symbol} (pmlId=${pmlId}) from ${fromDate} to ${toDate}`);
      await this.fetchStock({ symbol, pmlId } as StockConfig, fromDate, toDate);
      this.log.info(`Done — fetched=${this.fetchedCount} skipped=${this.skippedCount} errors=${this.errorCount}`);
      return;
    }

    this.log.info(`Fetching daily OHLCV from ${fromDate} to ${toDate} (${lookbackDays} days)`);

    const stocks = await this.firebase.getAllStocks();
    const stockList = Object.values(stocks).filter((s) => s.pmlId);

    if (stockList.length === 0) {
      this.log.info("No stocks with pmlId found");
      return;
    }

    this.log.info(`Found ${stockList.length} stocks with pmlId`);

    for (const stock of stockList) {
      await this.fetchStock(stock, fromDate, toDate);
      await this.delay(DELAY_BETWEEN_REQUESTS_MS);
    }

    this.log.info(`Done — fetched=${this.fetchedCount} skipped=${this.skippedCount} errors=${this.errorCount}`);
  }

  private async fetchStock(stock: StockConfig, fromDate: string, toDate: string): Promise<void> {
    const outputPath = resolve(OUTPUT_DIR, `${stock.symbol}.json`);

    try {
      const candles = await this.client.fetchOHLCV(stock.pmlId, fromDate, toDate, "DAY");

      if (candles.length === 0) {
        this.log.warn(`${stock.symbol} — no data returned`);
        this.skippedCount++;
        return;
      }

      writeFileSync(outputPath, JSON.stringify(candles));
      this.fetchedCount++;
      this.log.info(`${stock.symbol} — ${candles.length} candles`);
    } catch (err) {
      this.errorCount++;
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`${stock.symbol} — failed: ${msg}`);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

new FetchDailyOhlcvScript().start();
