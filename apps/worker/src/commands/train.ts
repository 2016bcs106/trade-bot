import moment from "moment";
import createLogger from "../utils/logger.ts";
import FirebaseClient from "../firebase/client.ts";
import ModelTrainer from "../training/model-trainer.ts";
import ModelManager from "../model-management/model-manager.ts";
import PaytmMoneyHistoricalProvider from "../data/providers/paytm-money-historical-provider.ts";
import { getEnabledSymbols } from "./utils.ts";

const logger = createLogger("cmd:train");
const DEFAULT_LOOKBACK_DAYS = 90;

/**
 * Train a new model for one or all enabled stocks.
 * Fetches data live from Paytm Money API, trains, saves to disk + Firebase.
 */
export async function handleTrain(symbol: string | null, all: boolean): Promise<void> {
  const symbols = await getEnabledSymbols(symbol, all);
  if (symbols.length === 0) {
    logger.error("Please specify --symbol=SYMBOL or --all");
    process.exit(1);
  }

  const firebase = new FirebaseClient();
  const provider = new PaytmMoneyHistoricalProvider();
  const trainer = new ModelTrainer(provider);
  const modelManager = new ModelManager();

  const toDate = moment().utcOffset("+05:30").format("YYYY-MM-DD");
  const fromDate = moment().utcOffset("+05:30").subtract(DEFAULT_LOOKBACK_DAYS, "days").format("YYYY-MM-DD");

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

    logger.info(`Training model for ${sym} (pmlId: ${pmlId})...`);
    const result = await trainer.train(sym, pmlId, fromDate, toDate, "linear-regression");

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

    // If this is the first model, promote to production
    const currentProd = modelManager.getProductionVersion(sym);
    if (!currentProd) {
      modelManager.promote(sym, version);
      await firebase.updateStock(sym, { currentProductionVersion: version });
      logger.info(`Promoted ${sym} ${version} to production (first model)`);
    }
  }
}
