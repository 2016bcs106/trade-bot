import { getDatabase, ref, push, set } from "firebase/database";
import BaseScript from "./base-script.ts";
import { now, nowISO } from "../utils/time.ts";
import { PendingTrainingEntry } from "../firebase/client.ts";
import ModelTrainer from "../training/model-trainer.ts";
import ModelManager from "../model-management/model-manager.ts";
import PaytmMoneyHistoricalProvider from "../data/providers/paytm-money-historical-provider.ts";
import { TrainingResult } from "../training/models/trainable-model.ts";

/**
 * Long-running listener that watches `pending_trainings/` in Firebase.
 * When a new entry is added (status=pending), it trains the model for that stock.
 *
 * After training completes, auto-queues predictions for the last 30 days.
 *
 * Usage: pnpm training-listener
 */
class TrainingListenerScript extends BaseScript {
  private processedCount = 0;
  private currentTask: string | null = null;
  private trainer!: ModelTrainer;
  private modelManager!: ModelManager;

  get scriptName(): string {
    return "training-listener";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      processedCount: this.processedCount,
      currentTask: this.currentTask,
    };
  }

  protected async run(): Promise<void> {
    const provider = new PaytmMoneyHistoricalProvider();
    this.trainer = new ModelTrainer(provider);
    this.modelManager = new ModelManager();

    this.log.info("Training listener started — watching pending_trainings/");

    // First, process any existing entries (regardless of status)
    const existing = await this.firebase.getAllPendingTrainings();
    const existingKeys = Object.keys(existing);

    if (existingKeys.length > 0) {
      this.log.info(`Found ${existingKeys.length} existing entries — processing...`);
      for (const key of existingKeys) {
        await this.processEntry(key, existing[key]);
      }
    }

    // Then listen for new additions (process all, no status filter)
    this.firebase.onPendingTrainingAdded(async (key, entry) => {
      this.log.info(`New pending training: ${entry.symbol} (${entry.modelType}, ${entry.lookbackDays}d)`);
      await this.processEntry(key, entry);
    });

    // Keep process alive
    this.log.info("Listening for new pending trainings... (Ctrl+C to stop)");
    await new Promise(() => {});
  }

  private async processEntry(key: string, entry: PendingTrainingEntry): Promise<void> {
    const { symbol, modelType, lookbackDays } = entry;
    this.currentTask = `${symbol} (${modelType}, ${lookbackDays}d)`;

    try {
      // Mark as processing
      await this.firebase.updatePendingTraining(key, { status: "processing" });

      const stock = await this.firebase.getStock(symbol);
      if (!stock) {
        throw new Error(`Stock ${symbol} not found in Firebase`);
      }

      const pmlId = stock.pmlId;
      if (!pmlId) {
        throw new Error(`Stock ${symbol} has no pmlId — re-run stock-sync`);
      }

      const toDate = now().format("YYYY-MM-DD");
      const fromDate = now().subtract(lookbackDays, "days").format("YYYY-MM-DD");

      this.log.info(`Training ${symbol}: ${modelType}, ${fromDate} → ${toDate}`);

      // Run training
      const result: TrainingResult | null = await this.trainer.train(
        symbol, pmlId, fromDate, toDate,
      );

      if (!result) {
        throw new Error("Training returned no result — insufficient data or model failure");
      }

      // Save model to disk and get version
      const version = this.modelManager.saveModel(result);

      // Save metadata to Firebase
      const metadata = this.modelManager.loadMetadata(symbol, version);
      if (metadata) {
        await this.firebase.setModelMetadata(symbol, version, metadata);
      }

      // Prune old versions (keep max 14)
      const pruned = this.modelManager.pruneOldVersions(symbol);
      for (const pv of pruned) {
        await this.firebase.removeModelMetadata(symbol, pv);
      }

      // Auto-promotion logic
      const currentProd = this.modelManager.getProductionVersion(symbol);
      if (!currentProd) {
        // First model → always promote to production
        this.modelManager.promote(symbol, version);
        await this.firebase.updateStock(symbol, { currentProductionVersion: version });
        const updatedMeta = this.modelManager.loadMetadata(symbol, version);
        if (updatedMeta) await this.firebase.setModelMetadata(symbol, version, updatedMeta);
        this.log.info(`First model for ${symbol} — auto-promoted ${version} to production`);
      } else if (stock.autoOptimize) {
        const prodMetadata = this.modelManager.loadMetadata(symbol, currentProd);
        if (prodMetadata && result.metrics.mae < prodMetadata.metrics.mae) {
          this.modelManager.promote(symbol, version);
          await this.firebase.updateStock(symbol, { currentProductionVersion: version });
          await this.firebase.setModelMetadata(symbol, version, this.modelManager.loadMetadata(symbol, version)!);
          await this.firebase.setModelMetadata(symbol, currentProd, this.modelManager.loadMetadata(symbol, currentProd)!);
          this.log.info(`Auto-promoted ${symbol} ${version} (MAE: ${result.metrics.mae.toFixed(2)} < ${prodMetadata.metrics.mae.toFixed(2)})`);
        }
      }

      // Done — remove from queue
      await this.firebase.updatePendingTraining(key, {
        status: "completed",
        resultVersion: version,
      });
      await this.firebase.removePendingTraining(key);

      // Auto-queue predictions for last 30 days
      await this.queuePredictions(symbol);

      this.processedCount++;
      this.currentTask = null;
      this.log.info(`✓ ${symbol}: trained ${version} (${result.modelType}, MAE=${result.metrics.mae.toFixed(2)})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`✗ ${symbol}: ${msg}`);
      await this.firebase.updatePendingTraining(key, { status: "failed", error: msg });
      this.currentTask = null;
    }
  }

  private async queuePredictions(symbol: string): Promise<void> {
    const db = getDatabase();
    const current = now();
    const fromDate = current.clone().subtract(30, "days").format("YYYY-MM-DD");
    const toDate = current.format("YYYY-MM-DD");

    const newRef = push(ref(db, "pending_predictions"));
    await set(newRef, {
      symbol,
      fromDate,
      toDate,
      status: "pending",
      createdAt: nowISO(),
    });
    this.log.info(`  → Queued predictions for ${symbol} (${fromDate} → ${toDate})`);
  }
}

new TrainingListenerScript().start();
