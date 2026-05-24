import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { now, parseDate, todayDate } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { OHLCV } from "../types/market-data/ohlcv.ts";
import { PreviousDayContext } from "../types/features/feature-vector.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";
import { getBusinessDays, evaluateAndSave } from "../utils/market-utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "..", "..", "data");

const logger = createLogger("handler:predict");

/**
 * Handles "predict" requests — generates predictions for a stock over a date range.
 *
 * Expected payload:
 * - symbol: string (stock symbol)
 * - fromDate: string (YYYY-MM-DD)
 * - toDate: string (YYYY-MM-DD)
 * - dataSource?: "api" | "local" (default: "api")
 *     - "api": fetch candles from Paytm Money historical API
 *     - "local": read from data/{SYMBOL}.json (minute-tick-collector output)
 */
export class PredictionRequestHandler implements RequestHandler {
  async handle(request: QueuedRequest, ctx: ServiceContext): Promise<void> {
    const { symbol, fromDate, toDate, dataSource = "api" } = request.payload as {
      symbol: string;
      fromDate: string;
      toDate: string;
      dataSource?: "api" | "local";
    };

    if (!symbol || !fromDate || !toDate) {
      throw new Error("predict requires payload: { symbol, fromDate, toDate }");
    }

    const { firebase, paytm: client, modelManager, predictionEngine } = ctx;

    const dates = getBusinessDays(fromDate, toDate);
    if (dates.length === 0) {
      logger.info(`No business days in range ${fromDate} → ${toDate}`);
      return;
    }

    const stock = await firebase.getStock(symbol);
    if (!stock || !stock.currentProductionVersion) {
      throw new Error(`No production model for ${symbol}`);
    }

    const pmlId = stock.pmlId;

    const metadata = modelManager.loadMetadata(symbol, stock.currentProductionVersion);
    const modelType = metadata?.modelType || "linear-regression";

    logger.info(`Predicting ${symbol}: ${fromDate} → ${toDate} (${dates.length} days, source=${dataSource})`);

    let processed = 0;

    for (const date of dates) {
      try {
        const candles = dataSource === "local"
          ? this.loadLocalCandles(symbol, date)
          : await client.fetchOHLCV(pmlId, date, date);

        if (candles.length < 30) {
          logger.warn(`Skipping ${symbol}@${date}: only ${candles.length} candles (need ≥30)`);
          processed++;
          continue;
        }

        // Fetch previous day candles for context
        const prevDate = parseDate(date).subtract(1, "day").format("YYYY-MM-DD");
        const prevCandles = await client.fetchOHLCV(pmlId, prevDate, prevDate);

        const prevDay: PreviousDayContext | null = prevCandles.length > 0
          ? {
              close: prevCandles[prevCandles.length - 1].close,
              high: Math.max(...prevCandles.map((c) => c.high)),
              averageMinVolume: prevCandles.slice(0, 105).reduce((s, c) => s + c.volume, 0),
              close2: null, high2: null, close3: null, high3: null,
            }
          : null;

        const prediction = predictionEngine.predict(
          symbol, date, candles, prevDay, stock.currentProductionVersion, modelType,
        );

        if (prediction) {
          // If market is closed for this date (past), evaluate inline
          const current = now();
          const predDate = parseDate(date, "YYYY-MM-DD");
          const marketCloseTime = predDate.clone().hour(15).minute(30);

          if (current.isAfter(marketCloseTime)) {
            const result = await evaluateAndSave(prediction, candles, firebase, symbol, date);
            const actualStr = result
              ? ` | Actual H=${prediction.actualHigh?.toFixed(2)} L=${prediction.actualLow?.toFixed(2)}`
              : "";
            logger.info(`✓ ${symbol}@${date}: HIGH=${prediction.predictedHigh.toFixed(2)}, LOW=${prediction.predictedLow.toFixed(2)}${actualStr}`);
          } else {
            await firebase.setPrediction(symbol, date, prediction);
            logger.info(`✓ ${symbol}@${date}: HIGH=${prediction.predictedHigh.toFixed(2)}, LOW=${prediction.predictedLow.toFixed(2)}`);
          }
        } else {
          logger.warn(`Prediction returned null for ${symbol}@${date}`);
        }
      } catch (dateErr) {
        const msg = dateErr instanceof Error ? dateErr.message : String(dateErr);
        logger.error(`✗ ${symbol}@${date}: ${msg}`);
      }

      processed++;
    }

    logger.info(`✓ Completed ${symbol}: ${fromDate} → ${toDate} (${processed}/${dates.length} dates)`);
  }

  /**
   * Load candles from local file written by minute-tick-collector.
   * File: data/{SYMBOL}.json — JSON array of OHLCV candles for today.
   * Filters to only return candles matching the requested date.
   */
  private loadLocalCandles(symbol: string, date: string): OHLCV[] {
    const filePath = resolve(DATA_DIR, `${symbol}.json`);

    if (!existsSync(filePath)) {
      logger.warn(`Local data file not found: ${filePath}`);
      return [];
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const candles: OHLCV[] = JSON.parse(content);

      // Filter candles for the requested date
      return candles.filter((c) => c.timestamp.startsWith(date));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to read local candles for ${symbol}: ${msg}`);
      return [];
    }
  }
}
