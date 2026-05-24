import moment from "moment";
import createLogger from "../utils/logger.ts";
import TradingConfig from "../config/trading-config.ts";
import FirebaseClient from "../firebase/client.ts";
import ModelTrainer from "../training/model-trainer.ts";
import ModelManager from "../model-management/model-manager.ts";
import PaytmMoneyHistoricalProvider from "../data/providers/paytm-money-historical-provider.ts";
import { ModelType } from "../training/models/trainable-model.ts";
import { getEnabledSymbols } from "./utils.ts";

const logger = createLogger("cmd:train");

/**
 * Train a new model for one or all enabled stocks.
 * Fetches data live from Paytm Money API, trains, saves to disk + Firebase.
 *
 * Usage: pnpm train --symbol=ADANIENT [--model=random-forest|linear-regression] [--lookbackDays=90]
 */
export async function handleTrain(): Promise<void> {
  const config = new TradingConfig("ml");

  const symbols = await getEnabledSymbols(config.symbol || null, config.all || false);
  if (symbols.length === 0) {
    logger.error("Please specify --symbol=SYMBOL or --all");
    process.exit(1);
  }

  const modelType = (config.model || "random-forest") as ModelType | "auto";
  const lookbackDays = config.lookbackDays || 90;

  const firebase = new FirebaseClient();
  const provider = new PaytmMoneyHistoricalProvider();
  const trainer = new ModelTrainer(provider);
  const modelManager = new ModelManager();

  const toDate = moment().utcOffset("+05:30").format("YYYY-MM-DD");
  const fromDate = moment().utcOffset("+05:30").subtract(lookbackDays, "days").format("YYYY-MM-DD");

  for (const sym of symbols) {
    const stock = await firebase.getStock(sym);
    if (!stock) {
      logger.error(`Stock ${sym} not found in Firebase`);
      continue;
    }

    const pmlId = stock.pmlId;
    if (!pmlId) {
      logger.error(`Stock ${sym} has no pmlId — re-run stock-sync`);
      continue;
    }

    logger.info(`Training ${sym} (pmlId: ${pmlId}, model: ${modelType}, lookback: ${lookbackDays}d)...`);
    const result = await trainer.train(sym, pmlId, fromDate, toDate, modelType);

    if (!result) {
      logger.error(`Training failed for ${sym}`);
      continue;
    }

    // Save model to disk and get version
    const version = modelManager.saveModel(result);
    logger.info(`Model saved: ${sym} ${version} (MAE: ${result.metrics.mae.toFixed(2)})`);

    // Save metadata to Firebase
    const metadata = modelManager.loadMetadata(sym, version);
    if (metadata) {
      await firebase.setModelMetadata(sym, version, metadata);
    }

    // Auto-promotion logic
    const currentProd = modelManager.getProductionVersion(sym);
    if (!currentProd) {
      // First model → always promote to production
      modelManager.promote(sym, version);
      await firebase.updateStock(sym, { currentProductionVersion: version });
      logger.info(`Promoted ${sym} ${version} to production (first model)`);
    } else if (stock.autoOptimize) {
      // Auto-optimize enabled → promote if new model is better (lower MAE)
      const prodMetadata = modelManager.loadMetadata(sym, currentProd);
      if (prodMetadata && result.metrics.mae < prodMetadata.metrics.mae) {
        modelManager.promote(sym, version);
        await firebase.updateStock(sym, { currentProductionVersion: version });
        await firebase.setModelMetadata(sym, version, modelManager.loadMetadata(sym, version)!);
        await firebase.setModelMetadata(sym, currentProd, modelManager.loadMetadata(sym, currentProd)!);
        logger.info(`Auto-promoted ${sym} ${version} → production (MAE: ${result.metrics.mae.toFixed(2)} < ${prodMetadata.metrics.mae.toFixed(2)})`);
      } else {
        logger.info(`Shadow ${sym} ${version} not promoted (MAE not better than production ${currentProd})`);
      }
    }
  }
}
