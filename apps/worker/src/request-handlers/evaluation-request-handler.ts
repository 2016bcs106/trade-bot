import createLogger from "../utils/logger.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";
import { evaluateAndSave, loadLocalCandles } from "../utils/market-utils.ts";

const logger = createLogger("handler:evaluate");

/**
 * Handles "evaluate" requests — evaluates a prediction against actuals.
 *
 * Expected payload:
 * - symbol: string (stock symbol)
 * - date: string (YYYY-MM-DD)
 * - dataSource?: "api" | "local" (default: "api")
 *     - "api": fetch candles from Paytm Money historical API
 *     - "local": read from data/{SYMBOL}.json (minute-tick-collector output)
 *
 * Flow:
 * 1. Fetch the prediction for the given symbol+date
 * 2. Skip if already evaluated
 * 3. Fetch full-day OHLCV candles (from API or local)
 * 4. Use shared evaluateAndSave to compute actuals, run evaluation, persist
 */
export class EvaluationRequestHandler implements RequestHandler {
  async handle(request: QueuedRequest, ctx: ServiceContext): Promise<void> {
    const { symbol, date, dataSource = "api" } = request.payload as {
      symbol: string;
      date: string;
      dataSource?: "api" | "local";
    };

    if (!symbol || !date) {
      throw new Error("evaluate requires payload: { symbol, date }");
    }

    const { firebase, paytm: client } = ctx;

    // 1. Get existing prediction
    const prediction = await firebase.getPrediction(symbol, date);
    if (!prediction) {
      logger.info(`No prediction found for ${symbol} on ${date} — skipping`);
      return;
    }

    if (prediction.evaluated) {
      logger.info(`${symbol} already evaluated for ${date} — skipping`);
      return;
    }

    // 2. Get stock config for pmlId
    const stock = await firebase.getStock(symbol);
    if (!stock?.pmlId) {
      throw new Error(`Stock ${symbol} has no pmlId — re-run stock-sync`);
    }

    // 3. Fetch full-day candles
    const candles = dataSource === "local"
      ? loadLocalCandles(symbol, date)
      : await client.fetchOHLCV(stock.pmlId, date, date);

    // 4. Evaluate and save
    const result = await evaluateAndSave(prediction, candles, firebase, symbol, date);

    if (result) {
      logger.info(`✓ ${symbol}@${date} (source=${dataSource}): MAE=${result.mae.toFixed(2)}, MAPE=${result.mape.toFixed(2)}%, range=${result.rangeContainment ? "✓" : "✗"}`);
    } else {
      logger.warn(`${symbol}@${date}: insufficient data for evaluation (${candles.length} candles, need ≥100)`);
    }
  }
}
