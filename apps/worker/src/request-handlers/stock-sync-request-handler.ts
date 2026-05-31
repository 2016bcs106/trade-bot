import { nowISO } from "../utils/time.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { StockConfig } from "../types/stocks/index.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";

/**
 * Handles "stock_sync" requests — resolves a stock symbol via Paytm Money API,
 * saves the full StockConfig to Firebase.
 *
 * Also handles stock removal when action: "remove" is specified.
 *
 * Expected payload:
 * - symbol: string (stock symbol, e.g. "ADANIENT")
 * - action: "sync" | "remove" (default "sync")
 */
export class StockSyncRequestHandler implements RequestHandler {
  async handle(request: QueuedRequest, ctx: ServiceContext): Promise<void> {
    const {
      symbol,
      action = "sync",
    } = request.payload as {
      symbol: string;
      action?: "sync" | "remove";
    };

    if (!symbol) {
      throw new Error("stock_sync requires payload: { symbol }");
    }

    const { firebase, paytm: client } = ctx;

    // ─── Handle stock removal ──────────────────────────────────────────
    if (action === "remove") {
      await this.handleRemove(symbol, ctx);
      return;
    }

    // ─── Step 1: Sync stock metadata ──────────────────────────────────

    ctx.log.info(`Syncing: ${symbol}`);

    const existingStock = await firebase.getStock(symbol);
    const isResync = !!existingStock;

    const result = await client.searchStock(symbol);

    if (!result) {
      ctx.log.error(`No exact NSE match for symbol: ${symbol} — marking as sync_failed`);
      if (isResync) {
        await firebase.updateStock(symbol, { status: "sync_failed", updatedAt: nowISO() });
      } else {
        await firebase.setStock(symbol, {
          symbol,
          name: symbol,
          securityId: 0,
          pmlId: "",
          exchange: "NSE",
          enabled: false,
          addedAt: nowISO(),
          updatedAt: nowISO(),
          status: "sync_failed",
        });
      }
      throw new Error(`No exact NSE equity match for symbol: ${symbol}`);
    }

    if (isResync) {
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
        enabled: true,
        addedAt: nowISO(),
        updatedAt: nowISO(),
        status: "synced",
      };
      await firebase.setStock(symbol, config);
    }
    ctx.log.info(`✓ Synced: ${symbol} → ${result.name} (${result.exchange}, ID: ${result.security_id})`);
  }

  private async handleRemove(symbol: string, ctx: ServiceContext): Promise<void> {
    const { firebase } = ctx;

    ctx.log.info(`Removing stock: ${symbol}`);

    await firebase.removeStock(symbol);
    ctx.log.info(`  🗑️  Removed stocks/${symbol}`);

    ctx.log.info(`✓ Stock ${symbol} fully removed`);
  }
}
