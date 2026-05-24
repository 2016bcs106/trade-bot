import createLogger from "../utils/logger.ts";
import TradingConfig from "../config/trading-config.ts";
import FirebaseClient from "../firebase/client.ts";
import ModelManager from "../model-management/model-manager.ts";
import { StockConfig } from "../types/stocks/index.ts";
import { getEnabledSymbols } from "./utils.ts";

const logger = createLogger("cmd:optimize");

/**
 * Run optimization review — compare shadow vs production, promote if 5%+ better.
 * Only promotes when autoOptimize is enabled for the stock.
 *
 * Usage: pnpm optimize --symbol=ADANIENT or pnpm optimize --all
 */
export async function handleOptimize(): Promise<void> {
  const config = new TradingConfig("ml");
  const firebase = new FirebaseClient();
  const modelManager = new ModelManager();

  let symbols = await getEnabledSymbols(config.symbol || null, config.all || false);

  // Default: all stocks with autoOptimize enabled
  if (symbols.length === 0) {
    const stocks = await firebase.getAllStocks();
    symbols = Object.values(stocks)
      .filter((s: StockConfig) => s.enabled && s.autoOptimize)
      .map((s: StockConfig) => s.symbol);

    if (symbols.length === 0) {
      logger.info("No stocks with autoOptimize enabled");
      return;
    }
  }

  for (const sym of symbols) {
    const stock = await firebase.getStock(sym);
    if (!stock) {
      logger.error(`Stock ${sym} not found`);
      continue;
    }

    if (!stock.autoOptimize) {
      logger.info(`${sym}: autoOptimize disabled — skipping`);
      continue;
    }

    // Use Firebase as single source of truth for production version
    const prodVersion = stock.currentProductionVersion;
    const shadowVersion = modelManager.getShadowVersion(sym);

    if (!prodVersion || !shadowVersion) {
      logger.info(`${sym}: no production/shadow pair — skipping`);
      continue;
    }

    const prodMeta = modelManager.loadMetadata(sym, prodVersion);
    const shadowMeta = modelManager.loadMetadata(sym, shadowVersion);
    if (!prodMeta || !shadowMeta) continue;

    // Compare MAE (lower is better)
    const improvement = ((prodMeta.metrics.mae - shadowMeta.metrics.mae) / prodMeta.metrics.mae) * 100;

    if (improvement >= 5) {
      modelManager.promote(sym, shadowVersion);
      await firebase.updateStock(sym, { currentProductionVersion: shadowVersion });
      // Sync metadata to Firebase so all flows see consistent state
      await firebase.setModelMetadata(sym, shadowVersion, modelManager.loadMetadata(sym, shadowVersion)!);
      await firebase.setModelMetadata(sym, prodVersion, modelManager.loadMetadata(sym, prodVersion)!);
      logger.info(`✓ Promoted ${sym}: ${shadowVersion} (${improvement.toFixed(1)}% better MAE)`);
    } else {
      logger.info(`${sym}: shadow not significantly better (${improvement.toFixed(1)}%, need ≥5%)`);
    }
  }
}
