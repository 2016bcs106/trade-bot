import "../config/env.ts";
import { getDatabase, ref, onChildAdded, onChildChanged } from "firebase/database";
import BaseScript from "./base-script.ts";
import { StockConfig } from "../types/stocks/index.ts";

interface PaytmSearchResult {
  id: string;
  name: string;
  isin: string;
  mcap: number;
  industry_code: string;
  industry_name: string;
  exchange: string;
  segment: string;
  security_id: number;
  symbol: string;
  series: string;
  instrument_type: string;
  tick_size: number;
  lot_size: number;
  freeze_quantity: number;
}

interface PaytmSearchResponse {
  data?: {
    results?: PaytmSearchResult[];
  };
}

/**
 * Stock Sync Script
 *
 * Listens for new or updated entries under `stocks/` with status "pending_sync".
 * Calls Paytm Money search API to resolve the symbol, then updates Firebase
 * with the full stock config (name, securityId, exchange, enabled, etc.).
 *
 * Uses onChildAdded/onChildChanged to react only to new/updated entries,
 * not the entire existing dataset on startup.
 *
 * Usage: pnpm stock-sync
 */
class StockSyncScript extends BaseScript {
  private synced = 0;
  private failed = 0;
  private lastSyncAt: string | null = null;
  private processing = new Set<string>();

  get scriptName(): string {
    return "stock-sync";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      synced: this.synced,
      failed: this.failed,
      lastSyncAt: this.lastSyncAt,
    };
  }

  protected async run(): Promise<void> {
    this.log.info("Listening for new/updated stocks with pending_sync status...");

    const db = getDatabase();
    const stocksRef = ref(db, "stocks");

    // Fires for each existing child on startup + new children added later
    onChildAdded(stocksRef, (snapshot) => {
      const stock = snapshot.val();
      if (stock?.status === "pending_sync") {
        this.handlePendingStock(stock);
      }
    });

    // Fires when an existing child is updated (e.g. status set back to pending_sync)
    onChildChanged(stocksRef, (snapshot) => {
      const stock = snapshot.val();
      if (stock?.status === "pending_sync") {
        this.handlePendingStock(stock);
      }
    });

    // Keep process alive
    await new Promise(() => {});
  }

  private async handlePendingStock(stock: { symbol: string; addedAt?: number }): Promise<void> {
    const { symbol } = stock;

    // Prevent duplicate processing
    if (this.processing.has(symbol)) return;
    this.processing.add(symbol);

    try {
      await this.syncStock(stock);
    } finally {
      this.processing.delete(symbol);
    }
  }

  private async syncStock(stock: { symbol: string; addedAt?: number }): Promise<void> {
    const { symbol } = stock;
    this.log.info(`Syncing: ${symbol}`);

    try {
      const result = await this.searchPaytmMoney(symbol);

      if (!result) {
        this.log.error(`No exact NSE match for symbol: ${symbol} — marking as sync_failed`);
        this.failed++;
        await this.firebase.setStock(symbol, {
          symbol,
          name: symbol,
          securityId: 0,
          exchange: "NSE",
          enabled: false,
          autoOptimize: false,
          currentProductionVersion: null,
          addedAt: stock.addedAt || Date.now(),
          updatedAt: Date.now(),
          status: "sync_failed",
        } as any);
        return;
      }

      const config: StockConfig = {
        symbol: result.symbol,
        name: result.name,
        securityId: result.security_id,
        isin: result.isin,
        industryName: result.industry_name !== "NULL" ? result.industry_name : undefined,
        mcap: result.mcap,
        tickSize: result.tick_size,
        lotSize: result.lot_size,
        exchange: "NSE",
        enabled: true,
        autoOptimize: true,
        currentProductionVersion: null,
        addedAt: stock.addedAt || Date.now(),
        updatedAt: Date.now(),
      };

      await this.firebase.setStock(symbol, config);
      this.synced++;
      this.lastSyncAt = new Date().toISOString();
      this.log.info(`✓ Synced: ${symbol} → ${result.name} (${result.exchange}, ID: ${result.security_id})`);
    } catch (error) {
      this.failed++;
      this.log.error(`Failed to sync ${symbol}`, error);
    }
  }

  private async searchPaytmMoney(query: string): Promise<PaytmSearchResult | null> {
    const url = `https://api-eq.paytmmoney.com/data/v2/suggest?is-advanced-user=false&search-scope=ALL&q=${encodeURIComponent(query)}`;

    const ssoToken = process.env.PAYTM_MONEY_SSO_TOKEN;
    const twoFaToken = process.env.PAYTM_MONEY_2FA_TOKEN;
    const userId = process.env.PAYTM_MONEY_USER_ID;
    const deviceId = process.env.PAYTM_MONEY_DEVICE_ID;

    if (!ssoToken || !twoFaToken) {
      throw new Error("Missing PAYTM_MONEY_SSO_TOKEN or PAYTM_MONEY_2FA_TOKEN in .env");
    }

    const response = await fetch(url, {
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "origin": "https://www.paytmmoney.com",
        "referer": "https://www.paytmmoney.com/",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        "x-pmngx-key": "paytmmoney",
        "x-pmmodule-name": "paytmmoney",
        "x-sso-token": ssoToken,
        "x-2fa-token": twoFaToken,
        "x-user-agent": JSON.stringify({
          platform: "web",
          user_id: userId || "",
          device_id: deviceId || "",
        }),
      },
    });

    if (!response.ok) {
      throw new Error(`Paytm API returned ${response.status}: ${response.statusText}`);
    }

    const json = (await response.json()) as PaytmSearchResponse;
    const results = json.data?.results || [];

    if (results.length === 0) return null;

    // Strict: only NSE with exact symbol match
    const exactNSE = results.find(
      (r) => r.symbol.toUpperCase() === query.toUpperCase() && r.exchange === "NSE"
    );

    // If no exact NSE match, return null (sync_failed)
    return exactNSE || null;
  }
}

new StockSyncScript().start();
