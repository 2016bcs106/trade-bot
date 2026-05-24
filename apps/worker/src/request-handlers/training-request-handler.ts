import { now } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import FirebaseClient, { QueuedRequest } from "../firebase/client.ts";
import ModelTrainer from "../training/model-trainer.ts";
import ModelManager from "../model-management/model-manager.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";
import { RequestHandler } from "./request-handler.ts";

const logger = createLogger("handler:train");

/**
 * Handles "train" requests — trains a model for a stock using historical data.
 *
 * Stock status transitions:
 * - On start: status → "training_in_progress"
 * - On success: status → "ready"
 * - On failure (first training, no production model): status → "training_failed"
 * - On failure (has existing production model): status stays "ready", logs error
 *
 * In all failure cases, the request is moved to failed_requests collection.
 *
 * Expected payload:
 * - symbol: string (stock symbol)
 * - lookbackDays: number (default 1825 = 5 years)
 */
export class TrainingRequestHandler implements RequestHandler {
  async handle(request: QueuedRequest): Promise<void> {
    const { symbol, lookbackDays = 1825 } = request.payload as {
      symbol: string;
      lookbackDays?: number;
    };

    if (!symbol) {
      throw new Error("train requires payload: { symbol }");
    }

    const firebase = new FirebaseClient();
    const client = new PaytmMoneyClient();
    const trainer = new ModelTrainer(client);
    const modelManager = new ModelManager();

    const stock = await firebase.getStock(symbol);
    if (!stock) {
      throw new Error(`Stock ${symbol} not found in Firebase`);
    }

    const pmlId = stock.pmlId;
    if (!pmlId) {
      throw new Error(`Stock ${symbol} has no pmlId — sync first`);
    }

    const isFirstTraining = !stock.currentProductionVersion;

    // Mark status as pending training
    await firebase.updateStock(symbol, { status: "pending_training" });

    const toDate = now().format("YYYY-MM-DD");
    const fromDate = now().subtract(lookbackDays, "days").format("YYYY-MM-DD");

    logger.info(`Training ${symbol}: ${fromDate} → ${toDate} (${lookbackDays}d lookback)`);

    let result;
    try {
      result = await trainer.train(symbol, pmlId, fromDate, toDate);
    } catch (err) {
      await this.handleFailure(firebase, symbol, isFirstTraining, err);
      throw err;
    }

    if (!result) {
      const error = new Error("Training returned no result — insufficient data or model failure");
      await this.handleFailure(firebase, symbol, isFirstTraining, error);
      throw error;
    }

    // Save model to disk and get version
    const version = modelManager.saveModel(result);

    // Save metadata to Firebase
    const metadata = modelManager.loadMetadata(symbol, version);
    if (metadata) {
      await firebase.setModelMetadata(symbol, version, metadata);
    }

    // Prune old versions (keep max 14)
    const pruned = modelManager.pruneOldVersions(symbol);
    for (const pv of pruned) {
      await firebase.removeModelMetadata(symbol, pv);
    }
    if (pruned.length > 0) {
      logger.info(`Pruned ${pruned.length} old version(s): ${pruned.join(", ")}`);
    }

    // Auto-promotion logic
    const currentProd = modelManager.getProductionVersion(symbol);
    if (!currentProd) {
      // First model → always promote to production
      modelManager.promote(symbol, version);
      await firebase.updateStock(symbol, { currentProductionVersion: version });
      const updatedMeta = modelManager.loadMetadata(symbol, version);
      if (updatedMeta) await firebase.setModelMetadata(symbol, version, updatedMeta);
      logger.info(`First model for ${symbol} — promoted ${version} to production`);
    } else if (stock.autoOptimize) {
      const prodMetadata = modelManager.loadMetadata(symbol, currentProd);
      if (prodMetadata && result.metrics.mae < prodMetadata.metrics.mae) {
        modelManager.promote(symbol, version);
        await firebase.updateStock(symbol, { currentProductionVersion: version });
        await firebase.setModelMetadata(symbol, version, modelManager.loadMetadata(symbol, version)!);
        await firebase.setModelMetadata(symbol, currentProd, modelManager.loadMetadata(symbol, currentProd)!);
        logger.info(`Auto-promoted ${symbol} ${version} (MAE: ${result.metrics.mae.toFixed(2)} < ${prodMetadata.metrics.mae.toFixed(2)})`);
      } else {
        logger.info(`Shadow ${symbol} ${version} not promoted (MAE not better than production ${currentProd})`);
      }
    }

    // Mark stock as ready
    await firebase.updateStock(symbol, { status: "ready" });
    logger.info(`✓ ${symbol}: trained ${version} (${result.modelType}, MAE=${result.metrics.mae.toFixed(2)})`);
  }

  private async handleFailure(firebase: FirebaseClient, symbol: string, isFirstTraining: boolean, err: unknown): Promise<void> {
    const msg = err instanceof Error ? err.message : String(err);

    if (isFirstTraining) {
      // First training failed → mark stock as training_failed
      await firebase.updateStock(symbol, { status: "training_failed" });
      logger.error(`✗ ${symbol}: first training failed — status set to training_failed: ${msg}`);
    } else {
      // Has existing production model → keep status as ready, just log
      await firebase.updateStock(symbol, { status: "ready" });
      logger.error(`✗ ${symbol}: retraining failed (production model still active): ${msg}`);
    }
  }
}
