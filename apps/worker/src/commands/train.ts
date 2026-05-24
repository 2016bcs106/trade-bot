import createLogger from "../utils/logger.ts";
import FirebaseClient from "../firebase/client.ts";
import ModelTrainer from "../training/model-trainer.ts";
import ModelManager from "../model-management/model-manager.ts";
import { getEnabledSymbols } from "./utils.ts";

const logger = createLogger("cmd:train");

/**
 * Train a new model for one or all enabled stocks.
 * Saves model to disk, metadata to Firebase, auto-promotes first model.
 */
export async function handleTrain(symbol: string | null, all: boolean): Promise<void> {
  const symbols = await getEnabledSymbols(symbol, all);
  if (symbols.length === 0) {
    logger.error("Please specify --symbol or --all");
    process.exit(1);
  }

  const firebase = new FirebaseClient();
  const trainer = new ModelTrainer();
  const modelManager = new ModelManager();

  for (const sym of symbols) {
    logger.info(`Training model for ${sym}...`);
    const result = trainer.train(sym, "linear-regression");

    if (!result) {
      logger.error(`Training failed for ${sym} — insufficient data`);
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
