import moment from "moment";
import createLogger from "../utils/logger.ts";
import TradingConfig from "../config/trading-config.ts";
import FirebaseClient from "../firebase/client.ts";
import EvaluationEngine from "../evaluation/evaluation-engine.ts";
import PaytmMoneyHistoricalProvider from "../data/providers/paytm-money-historical-provider.ts";
import { getEnabledSymbols } from "./utils.ts";

const logger = createLogger("cmd:evaluate");

/**
 * Evaluate today's predictions against actual high/low fetched from API.
 *
 * Usage: pnpm evaluate --symbol=ADANIENT or pnpm evaluate --all
 */
export async function handleEvaluate(): Promise<void> {
  const config = new TradingConfig("ml");

  const symbols = await getEnabledSymbols(config.symbol || null, config.all || false);
  if (symbols.length === 0) {
    logger.error("Please specify --symbol=SYMBOL or --all");
    process.exit(1);
  }

  const firebase = new FirebaseClient();
  const evaluationEngine = new EvaluationEngine();
  const provider = new PaytmMoneyHistoricalProvider();
  const today = moment().utcOffset("+05:30").format("YYYY-MM-DD");

  for (const sym of symbols) {
    const prediction = await firebase.getPrediction(sym, today);
    if (!prediction) {
      logger.error(`No prediction found for ${sym} on ${today}`);
      continue;
    }

    if (prediction.evaluated) {
      logger.info(`${sym} already evaluated for ${today}, skipping`);
      continue;
    }

    const stock = await firebase.getStock(sym);
    if (!stock) {
      logger.error(`Stock ${sym} not found`);
      continue;
    }

    const pmlId = stock.pmlId;
    if (!pmlId) {
      logger.error(`Stock ${sym} has no pmlId — re-run stock-sync`);
      continue;
    }

    // Fetch full-day candles from API
    const candles = await provider.fetchOHLCV({
      symbol: sym, securityId: pmlId, exchange: "NSE",
      fromDate: today, toDate: today, interval: "MINUTE",
    });

    if (candles.length < 100) {
      logger.error(`Insufficient full-day data for ${sym} (${candles.length} candles) — market may not have closed`);
      continue;
    }

    const actualHigh = Math.max(...candles.map((c) => c.high));
    const actualLow = Math.min(...candles.map((c) => c.low));
    const actualClose = candles[candles.length - 1].close;

    prediction.actualHigh = actualHigh;
    prediction.actualLow = actualLow;
    prediction.actualClose = actualClose;
    prediction.evaluated = true;

    const result = evaluationEngine.evaluate(prediction);
    if (!result) {
      logger.error(`Evaluation failed for ${sym}`);
      continue;
    }

    await firebase.setPrediction(sym, today, prediction);
    await firebase.setEvaluation(sym, today, result);
    logger.info(`✓ ${sym}: MAE=${result.mae.toFixed(2)}, MAPE=${result.mape.toFixed(2)}%, range=${result.rangeContainment ? "✓" : "✗"}`);
  }
}
