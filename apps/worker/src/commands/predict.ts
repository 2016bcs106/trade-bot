import { todayDate, parseDate } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import TradingConfig from "../config/trading-config.ts";
import FirebaseClient from "../firebase/client.ts";
import ModelManager from "../model-management/model-manager.ts";
import PredictionEngine from "../prediction/prediction-engine.ts";
import PaytmMoneyHistoricalProvider from "../data/providers/paytm-money-historical-provider.ts";
import { PreviousDayContext } from "../types/features/feature-vector.ts";
import { getEnabledSymbols } from "./utils.ts";

const logger = createLogger("cmd:predict");

/**
 * Generate predictions for one or all enabled stocks using today's live data.
 *
 * Usage: pnpm predict --symbol=ADANIENT or pnpm predict --all
 */
export async function handlePredict(): Promise<void> {
  const config = new TradingConfig("ml");

  const symbols = await getEnabledSymbols(config.symbol || null, config.all || false);
  if (symbols.length === 0) {
    logger.error("Please specify --symbol=SYMBOL or --all");
    process.exit(1);
  }

  const firebase = new FirebaseClient();
  const modelManager = new ModelManager();
  const predictionEngine = new PredictionEngine();
  const provider = new PaytmMoneyHistoricalProvider();

  // Support --date=YYYY-MM-DD for adhoc/backtest predictions
  const targetDate = config.date || todayDate();
  const prevDate = parseDate(targetDate).subtract(1, "day").format("YYYY-MM-DD");
  logger.info(`Prediction date: ${targetDate}`);

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

    // Fetch target date candles from API
    const candles = await provider.fetchOHLCV({
      symbol: sym, securityId: pmlId, exchange: "NSE",
      fromDate: targetDate, toDate: targetDate, interval: "MINUTE",
    });

    if (candles.length < 30) {
      logger.error(`Insufficient data for ${sym} today (${candles.length} candles, need ≥30)`);
      continue;
    }

    // Fetch previous day candles for context
    const prevCandles = await provider.fetchOHLCV({
      symbol: sym, securityId: pmlId, exchange: "NSE",
      fromDate: prevDate, toDate: prevDate, interval: "MINUTE",
    });

    const prevDay: PreviousDayContext | null = prevCandles.length > 0
      ? {
          close: prevCandles[prevCandles.length - 1].close,
          high: Math.max(...prevCandles.map((c) => c.high)),
          avg45MinVolume: prevCandles.slice(0, 105).reduce((s, c) => s + c.volume, 0),
          close2: null,
          high2: null,
          close3: null,
          high3: null,
        }
      : null;

    // Get model type
    const metadata = modelManager.loadMetadata(sym, stock.currentProductionVersion);
    const modelType = metadata?.modelType || "linear-regression";

    // Generate prediction
    const prediction = predictionEngine.predict(
      sym, targetDate, candles, prevDay, stock.currentProductionVersion, modelType,
    );

    if (!prediction) {
      logger.error(`Prediction failed for ${sym}`);
      continue;
    }

    // For historical backfills where we have full-day data, fill actuals immediately
    if (candles.length >= 300) {
      prediction.actualHigh = Math.max(...candles.map((c) => c.high));
      prediction.actualLow = Math.min(...candles.map((c) => c.low));
      prediction.actualClose = candles[candles.length - 1].close;
      prediction.evaluated = true;
    }

    await firebase.setPrediction(sym, targetDate, prediction);
    logger.info(`✓ ${sym}: HIGH=${prediction.predictedHigh.toFixed(2)}, LOW=${prediction.predictedLow.toFixed(2)}`);
  }
}
