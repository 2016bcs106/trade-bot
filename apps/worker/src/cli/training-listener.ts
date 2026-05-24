import "../config/env.ts";
import moment from "moment";
import createLogger from "../utils/logger.ts";
import FirebaseClient, { PendingTrainingEntry } from "../firebase/client.ts";
import ModelTrainer from "../training/model-trainer.ts";
import ModelManager from "../model-management/model-manager.ts";
import PaytmMoneyHistoricalProvider from "../data/providers/paytm-money-historical-provider.ts";
import { ModelType, TrainingResult } from "../training/models/trainable-model.ts";
import { ScriptStatus } from "../types/script-status.ts";

const SCRIPT_NAME = "training-listener";
const HEARTBEAT_INTERVAL_MS = 60_000;
const logger = createLogger(SCRIPT_NAME);

let processedCount = 0;
let currentTask: string | null = null;

/**
 * Long-running listener that watches `pending_trainings/` in Firebase.
 * When a new entry is added (status=pending), it trains the model for that stock.
 *
 * Usage: pnpm training-listener
 */
async function main(): Promise<void> {
  const firebase = new FirebaseClient();
  const provider = new PaytmMoneyHistoricalProvider();
  const trainer = new ModelTrainer(provider);
  const modelManager = new ModelManager();

  const startedAt = moment().utcOffset("+05:30").valueOf();

  // ─── Heartbeat ──────────────────────────────────────────────────────
  const reportStatus = async (status: ScriptStatus["status"], error: string | null = null) => {
    const payload: ScriptStatus = {
      status,
      lastHeartbeat: moment().utcOffset("+05:30").valueOf(),
      startedAt,
      error,
      metadata: { processedCount, currentTask },
    };
    try {
      await firebase.updateScriptStatus(SCRIPT_NAME, payload);
    } catch (err) {
      logger.error(`Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  await reportStatus("running");
  const heartbeatTimer = setInterval(() => reportStatus("running"), HEARTBEAT_INTERVAL_MS);

  // ─── Graceful Shutdown ──────────────────────────────────────────────
  const shutdown = async (reason: string) => {
    logger.info(`Shutting down — reason=${reason}`);
    clearInterval(heartbeatTimer);
    await reportStatus("stopped");
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info("Training listener started — watching pending_trainings/");

  // First, process any existing pending entries
  const existing = await firebase.getAllPendingTrainings();
  const pendingKeys = Object.entries(existing)
    .filter(([, e]) => e.status === "pending")
    .map(([key]) => key);

  if (pendingKeys.length > 0) {
    logger.info(`Found ${pendingKeys.length} existing pending entries — processing...`);
    for (const key of pendingKeys) {
      await processEntry(key, existing[key], firebase, trainer, modelManager);
    }
  }

  // Then listen for new additions
  firebase.onPendingTrainingAdded(async (key, entry) => {
    if (entry.status !== "pending") return;
    logger.info(`New pending training: ${entry.symbol} (${entry.modelType}, ${entry.lookbackDays}d)`);
    await processEntry(key, entry, firebase, trainer, modelManager);
  });

  // Keep process alive
  logger.info("Listening for new pending trainings... (Ctrl+C to stop)");
}

async function processEntry(
  key: string,
  entry: PendingTrainingEntry,
  firebase: FirebaseClient,
  trainer: ModelTrainer,
  modelManager: ModelManager,
): Promise<void> {
  const { symbol, modelType, lookbackDays } = entry;
  currentTask = `${symbol} (${modelType}, ${lookbackDays}d)`;

  try {
    // Mark as processing
    await firebase.updatePendingTraining(key, { status: "processing" });

    const stock = await firebase.getStock(symbol);
    if (!stock) {
      throw new Error(`Stock ${symbol} not found in Firebase`);
    }

    const pmlId = stock.pmlId;
    if (!pmlId) {
      throw new Error(`Stock ${symbol} has no pmlId — re-run stock-sync`);
    }

    const toDate = moment().utcOffset("+05:30").format("YYYY-MM-DD");
    const fromDate = moment().utcOffset("+05:30").subtract(lookbackDays, "days").format("YYYY-MM-DD");

    logger.info(`Training ${symbol}: ${modelType}, ${fromDate} → ${toDate}`);

    // Run training (same API as handleTrain in commands/train.ts)
    const result: TrainingResult | null = await trainer.train(
      symbol, pmlId, fromDate, toDate, modelType as ModelType | "auto",
    );

    if (!result) {
      throw new Error("Training returned no result — insufficient data or model failure");
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

    // Auto-promotion logic
    const currentProd = modelManager.getProductionVersion(symbol);
    if (!currentProd) {
      // First model → always promote to production
      modelManager.promote(symbol, version);
      await firebase.updateStock(symbol, { currentProductionVersion: version });
      const updatedMeta = modelManager.loadMetadata(symbol, version);
      if (updatedMeta) await firebase.setModelMetadata(symbol, version, updatedMeta);
      logger.info(`First model for ${symbol} — auto-promoted ${version} to production`);
    } else if (stock.autoOptimize) {
      const prodMetadata = modelManager.loadMetadata(symbol, currentProd);
      if (prodMetadata && result.metrics.mae < prodMetadata.metrics.mae) {
        modelManager.promote(symbol, version);
        await firebase.updateStock(symbol, { currentProductionVersion: version });
        await firebase.setModelMetadata(symbol, version, modelManager.loadMetadata(symbol, version)!);
        await firebase.setModelMetadata(symbol, currentProd, modelManager.loadMetadata(symbol, currentProd)!);
        logger.info(`Auto-promoted ${symbol} ${version} (MAE: ${result.metrics.mae.toFixed(2)} < ${prodMetadata.metrics.mae.toFixed(2)})`);
      }
    }

    // Done — remove from queue
    await firebase.updatePendingTraining(key, {
      status: "completed",
      resultVersion: version,
    });
    await firebase.removePendingTraining(key);

    processedCount++;
    currentTask = null;
    logger.info(`✓ ${symbol}: trained ${version} (${result.modelType}, MAE=${result.metrics.mae.toFixed(2)})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`✗ ${symbol}: ${msg}`);
    await firebase.updatePendingTraining(key, { status: "failed", error: msg });
    currentTask = null;
  }
}

main().catch((e) => {
  logger.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
