import "../config/env.ts";
import moment from "moment";
import createLogger from "../utils/logger.ts";
import FirebaseClient, { PendingPredictionEntry } from "../firebase/client.ts";
import ModelManager from "../model-management/model-manager.ts";
import PredictionEngine from "../prediction/prediction-engine.ts";
import PaytmMoneyHistoricalProvider from "../data/providers/paytm-money-historical-provider.ts";
import { PreviousDayContext } from "../types/features/feature-vector.ts";

const logger = createLogger("prediction-listener");

/**
 * Long-running listener that watches `pending_predictions/` in Firebase.
 * When a new entry is added (status=pending), it generates the prediction
 * and updates the entry status.
 *
 * Usage: pnpm prediction-listener
 */
async function main(): Promise<void> {
  const firebase = new FirebaseClient();
  const modelManager = new ModelManager();
  const predictionEngine = new PredictionEngine();
  const provider = new PaytmMoneyHistoricalProvider();

  logger.info("Prediction listener started — watching pending_predictions/");

  // First, process any existing pending entries
  const existing = await firebase.getAllPendingPredictions();
  const pendingKeys = Object.entries(existing)
    .filter(([, e]) => e.status === "pending")
    .map(([key]) => key);

  if (pendingKeys.length > 0) {
    logger.info(`Found ${pendingKeys.length} existing pending entries — processing...`);
    for (const key of pendingKeys) {
      await processEntry(key, existing[key], firebase, modelManager, predictionEngine, provider);
    }
  }

  // Then listen for new additions
  firebase.onPendingPredictionAdded(async (key, entry) => {
    if (entry.status !== "pending") return;
    logger.info(`New pending prediction: ${entry.symbol} @ ${entry.date}`);
    await processEntry(key, entry, firebase, modelManager, predictionEngine, provider);
  });

  // Keep process alive
  logger.info("Listening for new pending predictions... (Ctrl+C to stop)");
}

async function processEntry(
  key: string,
  entry: PendingPredictionEntry,
  firebase: FirebaseClient,
  modelManager: ModelManager,
  predictionEngine: PredictionEngine,
  provider: PaytmMoneyHistoricalProvider,
): Promise<void> {
  const { symbol, date } = entry;

  try {
    // Mark as processing
    await firebase.updatePendingPrediction(key, { status: "processing" });

    const stock = await firebase.getStock(symbol);
    if (!stock || !stock.currentProductionVersion) {
      throw new Error(`No production model for ${symbol}`);
    }

    const pmlId = stock.pmlId;
    if (!pmlId) {
      throw new Error(`Stock ${symbol} has no pmlId`);
    }

    // Fetch candles for the target date
    const candles = await provider.fetchOHLCV({
      symbol, securityId: pmlId, exchange: "NSE",
      fromDate: date, toDate: date, interval: "MINUTE",
    });

    if (candles.length < 30) {
      throw new Error(`Insufficient data for ${symbol} on ${date} (${candles.length} candles, need ≥30)`);
    }

    // Fetch previous day candles
    const prevDate = moment(date).subtract(1, "day").format("YYYY-MM-DD");
    const prevCandles = await provider.fetchOHLCV({
      symbol, securityId: pmlId, exchange: "NSE",
      fromDate: prevDate, toDate: prevDate, interval: "MINUTE",
    });

    const prevDay: PreviousDayContext | null = prevCandles.length > 0
      ? {
          close: prevCandles[prevCandles.length - 1].close,
          high: Math.max(...prevCandles.map((c) => c.high)),
          avg45MinVolume: prevCandles.slice(0, 105).reduce((s, c) => s + c.volume, 0),
          close2: null, high2: null, close3: null, high3: null,
        }
      : null;

    // Get model type
    const metadata = modelManager.loadMetadata(symbol, stock.currentProductionVersion);
    const modelType = metadata?.modelType || "linear-regression";

    // Generate prediction
    const prediction = predictionEngine.predict(
      symbol, date, candles, prevDay, stock.currentProductionVersion, modelType,
    );

    if (!prediction) {
      throw new Error(`Prediction engine returned null for ${symbol} on ${date}`);
    }

    // Store prediction
    await firebase.setPrediction(symbol, date, prediction);

    // Mark completed and remove from queue
    await firebase.removePendingPrediction(key);
    logger.info(`✓ ${symbol}@${date}: HIGH=${prediction.predictedHigh.toFixed(2)}, LOW=${prediction.predictedLow.toFixed(2)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`✗ ${symbol}@${date}: ${msg}`);
    await firebase.updatePendingPrediction(key, { status: "failed", error: msg });
  }
}

main().catch((e) => {
  logger.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
