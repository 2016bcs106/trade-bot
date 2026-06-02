import "../config/env.ts";
import BaseScript from "./base-script.ts";
import { nowISO } from "../utils/time.ts";

const NSE_MARKET_STATUS_URL = "https://www.nseindia.com/api/marketStatus";

const HEADERS: Record<string, string> = {
  "accept": "*/*",
  "accept-language": "en-US,en;q=0.9",
  "sec-ch-ua": "\"Chromium\";v=\"148\", \"Google Chrome\";v=\"148\", \"Not/A)Brand\";v=\"99\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"macOS\"",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "Referer": "https://www.nseindia.com/resources/exchange-communication-holidays",
};

const POLL_INTERVAL_MS = 60_000;

class MarketStatusScript extends BaseScript {
  private lastStatus: string | null = null;
  private lastTradeDate: string | null = null;
  private lastFetchedAt: string | null = null;
  private fetchCount = 0;
  private errorCount = 0;

  get scriptName(): string {
    return "market-status";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      lastFetchedAt: this.lastFetchedAt,
      fetchCount: this.fetchCount,
      errorCount: this.errorCount,
      status: this.lastStatus,
      tradeDate: this.lastTradeDate,
    };
  }

  protected async run(): Promise<void> {
    this.log.info("Starting market status poller");

    await this.fetchAndPublish();
    setInterval(() => this.fetchAndPublish(), POLL_INTERVAL_MS);

    await new Promise(() => {});
  }

  private async fetchAndPublish(): Promise<void> {
    try {
      const response = await fetch(NSE_MARKET_STATUS_URL, {
        method: "GET",
        headers: HEADERS,
      });

      if (!response.ok) {
        this.errorCount++;
        this.log.warn(`NSE API returned ${response.status}`);
        return;
      }

      const data = await response.json();
      const capitalMarket = data.marketState?.find(
        (m: { market: string }) => m.market === "Capital Market"
      );

      if (!capitalMarket) {
        this.errorCount++;
        this.log.warn("Capital Market not found in response");
        return;
      }

      this.lastStatus = capitalMarket.marketStatus;
      this.lastTradeDate = capitalMarket.tradeDate;
      this.lastFetchedAt = nowISO();
      this.fetchCount++;

      this.log.info(`${capitalMarket.marketStatus} | tradeDate=${capitalMarket.tradeDate}`);

      await this.firebase.setValue("market_status", {
        status: capitalMarket.marketStatus,
        tradeDate: capitalMarket.tradeDate,
        updatedAt: this.lastFetchedAt,
      });
    } catch (err) {
      this.errorCount++;
      this.log.error("Failed to fetch market status", err);
    }
  }
}

new MarketStatusScript().start();
