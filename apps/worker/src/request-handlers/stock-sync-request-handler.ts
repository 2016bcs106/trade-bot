import { now, nowISO } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { StockConfig } from "../types/stocks/index.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";
import { TrainingRequestHandler } from "./training-request-handler.ts";
import { PredictionRequestHandler } from "./prediction-request-handler.ts";

const logger = createLogger("handler:stock-sync");

/**
 * Handles "stock_sync" requests — resolves a stock symbol via Paytm Money API,
 * saves the full StockConfig to Firebase, then chains training and prediction.
 *
 * Also handles stock removal when action: "remove" is specified.
 *
 * Expected payload:
 * - symbol: string (stock symbol, e.g. "ADANIENT")
 * - action: "sync" | "remove" (default "sync")
 * - shouldSkipTraining: boolean (default false)
 * - shouldSkipPredicting: boolean (default false)
 *
 * Chain (sync): stock_sync → train (5yr) → predict (last 30 days)
 * If any step fails, the entire request fails (moved to failed_requests).
 */
export class StockSyncRequestHandler implements RequestHandler {
  async handle(request: QueuedRequest, ctx: ServiceContext): Promise<void> {
    const {
      symbol,
      action = "sync",
      shouldSkipTraining = false,
      shouldSkipPredicting = false,
    } = request.payload as {
      symbol: string;
      action?: "sync" | "remove";
      shouldSkipTraining?: boolean;
      shouldSkipPredicting?: boolean;
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

    logger.info(`Syncing: ${symbol}`);

    const existingStock = await firebase.getStock(symbol);
    const isResync = !!existingStock;

    const result = await client.searchStock(symbol);

    if (!result) {
      logger.error(`No exact NSE match for symbol: ${symbol} — marking as sync_failed`);
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
          autoOptimize: false,
          currentProductionVersion: null,
          addedAt: nowISO(),
          updatedAt: nowISO(),
          status: "sync_failed",
        });
      }
      throw new Error(`No exact NSE equity match for symbol: ${symbol}`);
    }

    if (isResync) {
      // Re-sync: update metadata but preserve user config (enabled, autoOptimize, currentProductionVersion)
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
      // First sync: create full record
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
        autoOptimize: true,
        currentProductionVersion: null,
        addedAt: nowISO(),
        updatedAt: nowISO(),
        status: "synced",
      };
      await firebase.setStock(symbol, config);
    }
    logger.info(`✓ Synced: ${symbol} → ${result.name} (${result.exchange}, ID: ${result.security_id})`);

    // ─── Step 2: Train model (5 years of data) ───────────────────────

    if (!shouldSkipTraining) {
      logger.info(`Chaining training for ${symbol}...`);
      const trainHandler = new TrainingRequestHandler();
      await trainHandler.handle({
        type: "train",
        payload: { symbol, lookbackDays: 1825 },
        status: "processing",
        createdAt: request.createdAt,
      }, ctx);
    }

    // ─── Step 3: Generate predictions (last 30 days) ─────────────────

    if (!shouldSkipPredicting) {
      logger.info(`Chaining predictions for ${symbol} (last 30 days)...`);
      const predictHandler = new PredictionRequestHandler();
      const toDate = now().format("YYYY-MM-DD");
      const fromDate = now().subtract(30, "days").format("YYYY-MM-DD");
      await predictHandler.handle({
        type: "predict",
        payload: { symbol, fromDate, toDate },
        status: "processing",
        createdAt: request.createdAt,
      }, ctx);
    }
  }

  /**
   * Remove a stock completely — cleans Firebase AND local model files.
   */
  private async handleRemove(symbol: string, ctx: ServiceContext): Promise<void> {
    const { firebase, modelManager } = ctx;

    logger.info(`Removing stock: ${symbol}`);

    // Remove from Firebase (stock config, models metadata, predictions)
    await firebase.removeStock(symbol);
    logger.info(`  🗑️  Removed stocks/${symbol}`);

    await firebase.removeModels(symbol);
    logger.info(`  🗑️  Removed models/${symbol}`);

    await firebase.removePredictions(symbol);
    logger.info(`  🗑️  Removed predictions/${symbol}`);

    // Remove local model files from disk
    modelManager.deleteSymbolLocal(symbol);
    logger.info(`  🗑️  Removed local model files for ${symbol}`);

    logger.info(`✓ Stock ${symbol} fully removed`);
  }
}
