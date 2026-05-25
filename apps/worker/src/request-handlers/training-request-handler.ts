import { now } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import FirebaseClient, { QueuedRequest } from "../firebase/client.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";
import { OptimalTradeTimeRequestHandler } from "./optimal-trade-time-request-handler.ts";

const logger = createLogger("handler:train");

/**
 * Handles "train" requests — trains a model for a stock using historical data.
 *
 * Stock status transitions:
 * - On start: status → "pending_training"
 * - On success: status → "ready"
 * - On failure (first training, no production model): status → "training_failed"
 * - On failure (has existing production model): status stays "ready", logs error
 *
 * In all failure cases, the request is moved to failed_requests collection.
 *
 * Expected payload:
 * - symbol: string (stock symbol)
 */
export class TrainingRequestHandler implements RequestHandler {
  async handle(request: QueuedRequest, ctx: ServiceContext): Promise<void> {
    const { symbol } = request.payload as {
      symbol: string;
    };

    if (!symbol) {
      throw new Error("train requires payload: { symbol }");
    }

    const { firebase, trainer, modelManager } = ctx;

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
    const fromDate = "2015-01-01";

    logger.info(`Training ${symbol}: ${fromDate} → ${toDate}`);

    // Fetch all candles once, then train horizon-specific models
    let allCandles;
    try {
      allCandles = await ctx.paytm.fetchOHLCV(pmlId, fromDate, toDate, "MINUTE");
    } catch (err) {
      await this.handleFailure(firebase, symbol, isFirstTraining, err);
      throw err;
    }

    if (allCandles.length === 0) {
      const error = new Error("No candle data returned for training");
      await this.handleFailure(firebase, symbol, isFirstTraining, error);
      throw error;
    }

    logger.info(`Fetched ${allCandles.length} candles for ${symbol}`);

    // Train all horizons: 5, 10, 15, ..., 370, 375 (full day)
    const horizons = Array.from({ length: 75 }, (_, i) => (i + 1) * 5); // [5, 10, ..., 375]
    const horizonResults = trainer.trainHorizons(symbol, allCandles, horizons);

    if (horizonResults.length === 0) {
      const error = new Error("Training returned no results — insufficient data for all horizons");
      await this.handleFailure(firebase, symbol, isFirstTraining, error);
      throw error;
    }

    // --- Compute PromotionMetrics using weighted P75 strategy ---
    const LAMBDA = 0.005; // Decay rate: higher = more aggressive early-weight bias
    const PERCENTILE = 75; // Use 75th percentile (protects against worst-case without being overly strict)
    const MAX_MAPE_FIRST_HOUR = 3.0; // Hard floor: no early horizon can exceed 3% MAPE
    const MIN_DIR_FIRST_HOUR = 55.0; // Minimum directional accuracy for first hour horizons

    // Build per-horizon entries with exponential weights
    const perHorizon = horizonResults.map((hr) => ({
      horizon: hr.horizon,
      mae: hr.metrics.mae,
      mape: hr.metrics.mape,
      directionalAccuracy: hr.metrics.directionalAccuracy,
      weight: Math.exp(-LAMBDA * hr.horizon),
    }));

    // Compute weighted MAE values and sort descending for percentile
    const weightedMAEs = perHorizon.map((h) => h.mae * h.weight).sort((a, b) => b - a);
    const p75Index = Math.floor(weightedMAEs.length * (1 - PERCENTILE / 100));
    const weightedP75MAE = weightedMAEs[Math.min(p75Index, weightedMAEs.length - 1)];

    // Compute average MAE (informational)
    const avgMAE = perHorizon.reduce((sum, h) => sum + h.mae, 0) / perHorizon.length;

    // First hour horizons (5-60 min)
    const firstHourHorizons = perHorizon.filter((h) => h.horizon >= 5 && h.horizon <= 60);
    const maxMAPE_firstHour = firstHourHorizons.length > 0
      ? Math.max(...firstHourHorizons.map((h) => h.mape))
      : 0;
    const directionalAccuracy_firstHour = firstHourHorizons.length > 0
      ? firstHourHorizons.reduce((sum, h) => sum + h.directionalAccuracy, 0) / firstHourHorizons.length
      : 0;

    const promotionMetrics = {
      weightedP75MAE,
      avgMAE,
      maxMAPE_firstHour,
      directionalAccuracy_firstHour,
      horizonCount: horizonResults.length,
      perHorizon,
    };

    logger.info(`Promotion metrics: P75=${weightedP75MAE.toFixed(2)}, avgMAE=${avgMAE.toFixed(2)}, 1hr maxMAPE=${maxMAPE_firstHour.toFixed(1)}%, 1hr dir=${directionalAccuracy_firstHour.toFixed(1)}%`);

    // Use the full-day (375) model as the primary serialized model for version management
    const primaryResult = horizonResults.find((r) => r.horizon === 375) || horizonResults[horizonResults.length - 1];

    // Build a TrainingResult for saveModel (version management)
    const result = {
      modelType: "linear-regression" as const,
      symbol,
      serializedModel: primaryResult.serializedModel,
      training: {
        dataStartDate: fromDate,
        dataEndDate: toDate,
        sampleCount: horizonResults.length,
        featureCount: trainer.getFeatureCount(),
        features: trainer.getFeatureNames(),
        hyperparameters: {},
        durationMs: 0,
        windowSize: primaryResult.windowSize,
      },
      promotionMetrics,
    };

    // Save primary model to disk and get version
    const version = modelManager.saveModel(result);

    // Save all horizon-specific model files
    for (const hr of horizonResults) {
      modelManager.saveHorizonModel(symbol, version, hr.horizon, hr.serializedModel);
    }
    logger.info(`Trained ${horizonResults.length} horizon models for ${symbol} ${version}`);

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

    // --- Auto-promotion logic using weighted P75 + hard floors ---
    const currentProd = stock.currentProductionVersion;
    if (!currentProd) {
      // First model → always promote to production
      modelManager.promote(symbol, version);
      await firebase.updateStock(symbol, { currentProductionVersion: version });
      const updatedMeta = modelManager.loadMetadata(symbol, version);
      if (updatedMeta) await firebase.setModelMetadata(symbol, version, updatedMeta);
      logger.info(`First model for ${symbol} — promoted ${version} to production`);
    } else if (stock.autoOptimize) {
      const prodMetadata = modelManager.loadMetadata(symbol, currentProd);
      const prodP75 = prodMetadata?.promotionMetrics?.weightedP75MAE ?? Infinity;

      // Check hard floors: first hour MAPE and directional accuracy
      const passesHardFloor = maxMAPE_firstHour <= MAX_MAPE_FIRST_HOUR
        && directionalAccuracy_firstHour >= MIN_DIR_FIRST_HOUR;

      if (passesHardFloor && weightedP75MAE < prodP75) {
        modelManager.promote(symbol, version);
        await firebase.updateStock(symbol, { currentProductionVersion: version });
        await firebase.setModelMetadata(symbol, version, modelManager.loadMetadata(symbol, version)!);
        await firebase.setModelMetadata(symbol, currentProd, modelManager.loadMetadata(symbol, currentProd)!);
        logger.info(`Auto-promoted ${symbol} ${version} (P75: ${weightedP75MAE.toFixed(2)} < ${prodP75.toFixed(2)}, 1hr MAPE=${maxMAPE_firstHour.toFixed(1)}%, dir=${directionalAccuracy_firstHour.toFixed(1)}%)`);
      } else if (!passesHardFloor) {
        logger.info(`Shadow ${symbol} ${version} NOT promoted — hard floor failed (1hr MAPE=${maxMAPE_firstHour.toFixed(1)}% max=${MAX_MAPE_FIRST_HOUR}%, dir=${directionalAccuracy_firstHour.toFixed(1)}% min=${MIN_DIR_FIRST_HOUR}%)`);
      } else {
        logger.info(`Shadow ${symbol} ${version} NOT promoted (P75: ${weightedP75MAE.toFixed(2)} >= ${prodP75.toFixed(2)})`);
      }
    }

    // Mark stock as ready
    await firebase.updateStock(symbol, { status: "ready" });
    logger.info(`✓ ${symbol}: trained ${version} (${result.modelType}, P75=${weightedP75MAE.toFixed(2)}, avgMAE=${avgMAE.toFixed(2)})`);

    // Chain: re-compute optimal trade window with the new model
    logger.info(`Chaining optimal trade time computation for ${symbol}...`);
    const optimalHandler = new OptimalTradeTimeRequestHandler();
    await optimalHandler.handle({
      type: "optimal_trade_time",
      payload: { symbol, days: 30 },
      status: "processing",
      createdAt: request.createdAt,
    }, ctx);
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
