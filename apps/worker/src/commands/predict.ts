import moment from "moment";
import createLogger from "../utils/logger.ts";
import FirebaseClient from "../firebase/client.ts";
import ModelManager from "../model-management/model-manager.ts";
import PredictionEngine from "../prediction/prediction-engine.ts";
import NdjsonStorage from "../data/storage/ndjson-storage.ts";
import { PreviousDayContext } from "../types/features/feature-vector.ts";
import { getEnabledSymbols } from "./utils.ts";

const logger = createLogger("cmd:predict");

/**
 * Generate predictions for one or all enabled stocks using today's data.
 */
export async function handlePredict(symbol: string | null, all: boolean): Promise<void> {
  const symbols = await getEnabledSymbols(symbol, all);
  if (symbols.length === 0) {
    logger.error("Please specify --symbol or --all");
    process.exit(1);
  }

  const firebase = new FirebaseClient();
  const modelManager = new ModelManager();
  const predictionEngine = new PredictionEngine();
  const storage = new NdjsonStorage();
  const today = moment().utcOffset("+05:30").format("YYYY-MM-DD");

  for (const sym of symbols) {
    const stock = await firebase.getStock(sym);
    if (!stock || !stock.currentProductionVersion) {
      logger.error(`No production model for ${sym} — run train first`);
      continue;
    }

    // Load today's first 45-min candles
    const candles = storage.read(sym, "1min", today);
    if (candles.length < 30) {
      logger.error(`Insufficient data for ${sym} today (${candles.length} candles, need ≥30)`);
      continue;
    }

    // Load previous day context
    const yesterday = moment(today).subtract(1, "day").format("YYYY-MM-DD");
    const prevCandles = storage.read(sym, "1min", yesterday);
    const prevDay: PreviousDayContext | null = prevCandles.length > 0
      ? {
          close: prevCandles[prevCandles.length - 1].close,
          avg45MinVolume: prevCandles.slice(0, 45).reduce((s, c) => s + c.volume, 0),
        }
      : null;

    // Get model type
    const metadata = modelManager.loadMetadata(sym, stock.currentProductionVersion);
    const modelType = metadata?.modelType || "linear-regression";

    // Generate prediction
    const prediction = predictionEngine.predict(
      sym, today, candles, prevDay, stock.currentProductionVersion, modelType,
    );

    if (!prediction) {
      logger.error(`Prediction failed for ${sym}`);
      continue;
    }

    await firebase.setPrediction(sym, today, prediction);
    logger.info(`✓ ${sym}: HIGH=${prediction.predictedHigh.toFixed(2)}, LOW=${prediction.predictedLow.toFixed(2)}`);
  }
}
