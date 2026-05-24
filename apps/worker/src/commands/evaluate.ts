import moment from "moment";
import createLogger from "../utils/logger.ts";
import FirebaseClient from "../firebase/client.ts";
import EvaluationEngine from "../evaluation/evaluation-engine.ts";
import PaytmMoneyHistoricalProvider from "../data/providers/paytm-money-historical-provider.ts";
import { getEnabledSymbols } from "./utils.ts";

const logger = createLogger("cmd:evaluate");

/**
 * Evaluate today's predictions against actual high/low fetched from API.
 */
export async function handleEvaluate(symbol: string | null, all: boolean): Promise<void> {
  const symbols = await getEnabledSymbols(symbol, all);
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

    // Fetch full-day candles from API
    const candles = await provider.fetchOHLCV({
      symbol: sym, securityId: String(stock.securityId), exchange: "NSE",
      fromDate: today, toDate: today, interval: "MINUTE",
    });

    if (candles.length < 100) {
      logger.error(`Insufficient full-day data for ${sym} (${candles.length} candles) — market may not have closed`);
      continue;
    }

    const actualHigh = Math.max(...candles.map((c) => c.high));
    const actualLow = Math.min(...candles.map((c) => c.low));

    prediction.actualHigh = actualHigh;
    prediction.actualLow = actualLow;
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
