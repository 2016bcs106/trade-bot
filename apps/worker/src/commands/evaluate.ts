import moment from "moment";
import createLogger from "../utils/logger.ts";
import FirebaseClient from "../firebase/client.ts";
import EvaluationEngine from "../evaluation/evaluation-engine.ts";
import NdjsonStorage from "../data/storage/ndjson-storage.ts";
import { getEnabledSymbols } from "./utils.ts";

const logger = createLogger("cmd:evaluate");

/**
 * Evaluate today's predictions against actual high/low after market close.
 */
export async function handleEvaluate(symbol: string | null, all: boolean): Promise<void> {
  const symbols = await getEnabledSymbols(symbol, all);
  if (symbols.length === 0) {
    logger.error("Please specify --symbol or --all");
    process.exit(1);
  }

  const firebase = new FirebaseClient();
  const evaluationEngine = new EvaluationEngine();
  const storage = new NdjsonStorage();
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

    // Get actual high/low from full-day data
    const candles = storage.read(sym, "1min", today);
    if (candles.length < 100) {
      logger.error(`Insufficient full-day data for ${sym} (${candles.length} candles)`);
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
