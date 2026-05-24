import moment from "moment";
import createLogger from "../utils/logger.ts";
import FirebaseClient from "../firebase/client.ts";
import ModelManager from "../model-management/model-manager.ts";
import PredictionEngine from "../prediction/prediction-engine.ts";
import PaytmMoneyHistoricalProvider from "../data/providers/paytm-money-historical-provider.ts";
import { PreviousDayContext } from "../types/features/feature-vector.ts";
import { getEnabledSymbols } from "./utils.ts";

const logger = createLogger("cmd:predict");

/**
 * Generate predictions for one or all enabled stocks using today's live data.
 */
export async function handlePredict(symbol: string | null, all: boolean): Promise<void> {
  const symbols = await getEnabledSymbols(symbol, all);
  if (symbols.length === 0) {
    logger.error("Please specify --symbol=SYMBOL or --all");
    process.exit(1);
  }

  const firebase = new FirebaseClient();
  const modelManager = new ModelManager();
  const predictionEngine = new PredictionEngine();
  const provider = new PaytmMoneyHistoricalProvider();
  const today = moment().utcOffset("+05:30").format("YYYY-MM-DD");
  const yesterday = moment(today).subtract(1, "day").format("YYYY-MM-DD");

  for (const sym of symbols) {
    const stock = await firebase.getStock(sym);
    if (!stock || !stock.currentProductionVersion) {
      logger.error(`No production model for ${sym} — run train first`);
      continue;
    }

    const pmlId = stock.pmlId;
    if (!pmlId) {
      logger.error(`Stock ${sym} has no pmlId — re-run stock-sync`);
      continue;
    }

    // Fetch today's candles from API
    const candles = await provider.fetchOHLCV({
      symbol: sym, securityId: pmlId, exchange: "NSE",
      fromDate: today, toDate: today, interval: "MINUTE",
    });

    if (candles.length < 30) {
      logger.error(`Insufficient data for ${sym} today (${candles.length} candles, need ≥30)`);
      continue;
    }

    // Fetch yesterday's candles for previous day context
    const prevCandles = await provider.fetchOHLCV({
      symbol: sym, securityId: pmlId, exchange: "NSE",
      fromDate: yesterday, toDate: yesterday, interval: "MINUTE",
    });

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
