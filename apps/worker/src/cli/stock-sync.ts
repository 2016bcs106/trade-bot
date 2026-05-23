import "../config/env.ts";
import { getDatabase, ref, onChildAdded, onChildChanged } from "firebase/database";
import BaseScript from "./base-script.ts";
import { StockConfig } from "../types/stocks/index.ts";

interface PaytmSearchResult {
  symbol: string;
  name: string;
  security_id: string;
  exchange: string;
  isin: string;
}

interface PaytmSearchResponse {
  data?: PaytmSearchResult[];
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
        this.log.error(`No match found for symbol: ${symbol}`);
        this.failed++;
        await this.firebase.setStock(symbol, {
          symbol,
          name: symbol,
          securityId: "",
          exchange: "NSE",
          enabled: false,
          autoOptimize: false,
          currentProductionVersion: null,
          addedAt: stock.addedAt || Date.now(),
          updatedAt: Date.now(),
          status: "not_found",
        } as any);
        return;
      }

      const config: StockConfig = {
        symbol: result.symbol || symbol,
        name: result.name,
        securityId: result.security_id,
        exchange: result.exchange === "BSE" ? "BSE" : "NSE",
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

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent": "trade-bot/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Paytm API returned ${response.status}: ${response.statusText}`);
    }

    const json = (await response.json()) as PaytmSearchResponse;
    const results = json.data || [];

    if (results.length === 0) return null;

    // Find exact symbol match on NSE first, then BSE, then first result
    const exactNSE = results.find(
      (r) => r.symbol.toUpperCase() === query.toUpperCase() && r.exchange === "NSE"
    );
    if (exactNSE) return exactNSE;

    const exactBSE = results.find(
      (r) => r.symbol.toUpperCase() === query.toUpperCase() && r.exchange === "BSE"
    );
    if (exactBSE) return exactBSE;

    return results[0];
  }
}

new StockSyncScript().start();
