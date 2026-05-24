import { now, parseDate } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { PreviousDayContext } from "../types/features/feature-vector.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";

const logger = createLogger("handler:predict");

/**
 * Handles "predict" requests — generates predictions for a stock over a date range.
 *
 * Expected payload:
 * - symbol: string (stock symbol)
 * - fromDate: string (YYYY-MM-DD)
 * - toDate: string (YYYY-MM-DD)
 */
export class PredictionRequestHandler implements RequestHandler {
  async handle(request: QueuedRequest, ctx: ServiceContext): Promise<void> {
    const { symbol, fromDate, toDate } = request.payload as {
      symbol: string;
      fromDate: string;
      toDate: string;
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

    logger.info(`Predicting ${symbol}: ${fromDate} → ${toDate} (${dates.length} days)`);

    let processed = 0;

    for (const date of dates) {
      try {
        const candles = await client.fetchOHLCV(pmlId, date, date);

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
          // If market is closed for this date (past), fill actuals
          const current = now();
          const predDate = parseDate(date, "YYYY-MM-DD");
          const marketCloseTime = predDate.clone().hour(15).minute(30);
          if (current.isAfter(marketCloseTime)) {
            prediction.actualHigh = Math.max(...candles.map((c) => c.high));
            prediction.actualLow = Math.min(...candles.map((c) => c.low));
            prediction.actualClose = candles[candles.length - 1].close;
            prediction.evaluated = true;
          }

          await firebase.setPrediction(symbol, date, prediction);
          const actualStr = prediction.evaluated
            ? ` | Actual H=${prediction.actualHigh?.toFixed(2)} L=${prediction.actualLow?.toFixed(2)}`
            : "";
          logger.info(`✓ ${symbol}@${date}: HIGH=${prediction.predictedHigh.toFixed(2)}, LOW=${prediction.predictedLow.toFixed(2)}${actualStr}`);
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
}

/**
 * Expand a date range into business days (Mon-Fri).
 */
function getBusinessDays(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  const start = parseDate(fromDate, "YYYY-MM-DD");
  const end = parseDate(toDate, "YYYY-MM-DD");

  for (let d = start.clone(); d.isSameOrBefore(end); d.add(1, "day")) {
    const dow = d.day();
    if (dow !== 0 && dow !== 6) {
      dates.push(d.format("YYYY-MM-DD"));
    }
  }
  return dates;
}
