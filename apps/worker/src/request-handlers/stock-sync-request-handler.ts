import { nowISO } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import FirebaseClient, { QueuedRequest } from "../firebase/client.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";
import { StockConfig } from "../types/stocks/index.ts";
import { RequestHandler } from "./request-handler.ts";

const logger = createLogger("handler:stock-sync");

/**
 * Handles "stock_sync" requests — resolves a stock symbol via Paytm Money API
 * and saves the full StockConfig to Firebase.
 *
 * Expected payload:
 * - symbol: string (stock symbol, e.g. "ADANIENT")
 */
export class StockSyncRequestHandler implements RequestHandler {
  async handle(request: QueuedRequest): Promise<void> {
    const { symbol } = request.payload as { symbol: string };

    if (!symbol) {
      throw new Error("stock_sync requires payload: { symbol }");
    }

    const firebase = new FirebaseClient();
    const client = new PaytmMoneyClient();

    logger.info(`Syncing: ${symbol}`);

    const result = await client.searchStock(symbol);

    if (!result) {
      logger.error(`No exact NSE match for symbol: ${symbol} — marking as sync_failed`);
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
      throw new Error(`No exact NSE equity match for symbol: ${symbol}`);
    }

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
    logger.info(`✓ Synced: ${symbol} → ${result.name} (${result.exchange}, ID: ${result.security_id})`);
  }
}
