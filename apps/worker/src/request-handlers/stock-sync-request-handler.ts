import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import fetch from "node-fetch";
import { nowISO } from "../utils/time.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { StockConfig } from "../types/stocks/index.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "..", "..", "data");
const SYMBOLS_FILE = resolve(DATA_DIR, "stock-symbols.json");
const SECURITY_MASTER_URL = "https://developer.paytmmoney.com/data/v1/scrips/nse_security_master.csv";
const DELAY_BETWEEN_REQUESTS_MS = 500;

/**
 * Handles "stock_sync" requests — fetches NSE security master,
 * finds new symbols, and syncs them to Firebase.
 *
 * Payload (optional):
 * - force: boolean (force update all stocks)
 *
 * Also accepts --force as CLI arg for cron-based monthly full sync.
 */
export class StockSyncRequestHandler implements RequestHandler {
  async handle(request: QueuedRequest, ctx: ServiceContext): Promise<void> {
    mkdirSync(DATA_DIR, { recursive: true });

    const payloadForce = (request.payload as { force?: boolean })?.force ?? false;
    const cliForce = process.argv.includes("--force");
    const forceAll = payloadForce || cliForce;

    ctx.log.info(`Stock master sync started (force=${forceAll})`);

    const masterSymbols = await this.fetchSecurityMaster(ctx);
    ctx.log.info(`Security master: ${masterSymbols.length} symbols`);

    const existingSymbols = this.loadExistingSymbols();
    ctx.log.info(`Existing symbols: ${existingSymbols.length}`);

    let toSync: string[];
    if (forceAll) {
      toSync = masterSymbols;
      ctx.log.info(`Force sync: processing all ${toSync.length} symbols`);
    } else {
      toSync = masterSymbols.filter((s) => !existingSymbols.includes(s));
      ctx.log.info(`New symbols to sync: ${toSync.length}`);
    }

    if (toSync.length === 0) {
      ctx.log.info("Nothing to sync");
      this.saveSymbols(masterSymbols);
      return;
    }

    let syncedCount = 0;
    let failedCount = 0;

    for (const symbol of toSync) {
      try {
        const synced = await this.syncStock(symbol, forceAll, ctx);
        if (synced) {
          syncedCount++;
          ctx.log.info(`✓ ${symbol}`);
        } else {
          ctx.log.info(`— ${symbol} (skipped)`);
        }
      } catch (err) {
        failedCount++;
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.error(`✗ ${symbol}: ${msg}`);
      }
      await this.delay(DELAY_BETWEEN_REQUESTS_MS);
    }

    this.saveSymbols(masterSymbols);
    ctx.log.info(`Stock master sync complete — synced=${syncedCount} failed=${failedCount}`);
  }

  private async fetchSecurityMaster(ctx: ServiceContext): Promise<string[]> {
    ctx.log.info("Fetching security master CSV...");

    const response = await fetch(SECURITY_MASTER_URL);

    if (!response.ok) {
      throw new Error(`Security master fetch failed: ${response.status}`);
    }

    const csv = await response.text();
    const lines = csv.trim().split("\n");
    const header = this.parseCsvLine(lines[0]);

    const instrumentIdx = header.indexOf("instrument_type");
    const seriesIdx = header.indexOf("series");
    const symbolIdx = header.indexOf("symbol");

    if (instrumentIdx === -1 || seriesIdx === -1 || symbolIdx === -1) {
      throw new Error(`Unexpected CSV headers: ${header.join(", ")}`);
    }

    const symbols = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      const cols = this.parseCsvLine(lines[i]);
      if (cols[instrumentIdx] === "ES" && cols[seriesIdx] === "EQ") {
        const sym = cols[symbolIdx]?.trim();
        if (sym) symbols.add(sym);
      }
    }

    return Array.from(symbols).sort();
  }

  private async syncStock(symbol: string, isUpdate: boolean, ctx: ServiceContext): Promise<boolean> {
    const { firebase, paytm: client } = ctx;

    const result = await client.searchStock(symbol);
    if (!result) {
      ctx.log.warn(`No match for ${symbol}`);
      return false;
    }

    const existing = await firebase.getStock(symbol);

    if (existing && !isUpdate) {
      return false;
    }

    if (existing) {
      await firebase.updateStock(symbol, {
        name: result.name,
        securityId: result.security_id,
        pmlId: result.id,
        isin: result.isin,
        industryName: result.industry_name !== "NULL" ? result.industry_name : undefined,
        mcap: result.mcap,
        tickSize: result.tick_size,
        lotSize: result.lot_size,
        exchange: "NSE",
        updatedAt: nowISO(),
        status: "ready",
      });
    } else {
      const config: StockConfig = {
        symbol: result.symbol,
        name: result.name,
        securityId: result.security_id,
        pmlId: result.id,
        isin: result.isin,
        industryName: result.industry_name !== "NULL" ? result.industry_name : undefined,
        mcap: result.mcap,
        tickSize: result.tick_size,
        lotSize: result.lot_size,
        exchange: "NSE",
        addedAt: nowISO(),
        updatedAt: nowISO(),
        status: "synced",
      };
      await firebase.setStock(symbol, config);
    }

    return true;
  }

  private loadExistingSymbols(): string[] {
    if (!existsSync(SYMBOLS_FILE)) return [];
    try {
      return JSON.parse(readFileSync(SYMBOLS_FILE, "utf-8"));
    } catch {
      return [];
    }
  }

  private saveSymbols(symbols: string[]): void {
    writeFileSync(SYMBOLS_FILE, JSON.stringify(symbols));
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    result.push(current.trim());
    return result;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
