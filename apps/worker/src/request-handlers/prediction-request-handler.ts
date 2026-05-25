import { now, parseDate } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { PreviousDayContext } from "../types/features/feature-vector.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";
import { getBusinessDays, evaluateAndSave, loadLocalCandles } from "../utils/market-utils.ts";

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
          ? loadLocalCandles(symbol, date)
          : await client.fetchOHLCV(pmlId, date, date);

        if (candles.length < 30) {
          logger.warn(`Skipping ${symbol}@${date}: only ${candles.length} candles (need ≥30)`);
          processed++;
          continue;
        }

        // Fetch previous 7 calendar days to get last 3 trading days for context
        const prev7Start = parseDate(date).subtract(7, "day").format("YYYY-MM-DD");
        const prevDateEnd = parseDate(date).subtract(1, "day").format("YYYY-MM-DD");
        const prevCandles = await client.fetchOHLCV(pmlId, prev7Start, prevDateEnd);

        // Group by date and take last 3 trading days
        const byDate = new Map<string, typeof prevCandles>();
        for (const c of prevCandles) {
          const d = c.timestamp.split(" ")[0];
          const existing = byDate.get(d) || [];
          existing.push(c);
          byDate.set(d, existing);
        }
        const tradingDays = [...byDate.keys()].sort().reverse(); // most recent first

        const buildDayStats = (dayCandles: typeof prevCandles) => ({
          close: dayCandles[dayCandles.length - 1].close,
          high: Math.max(...dayCandles.map((c) => c.high)),
          low: Math.min(...dayCandles.map((c) => c.low)),
          avgVol: dayCandles.slice(0, 105).reduce((s, c) => s + c.volume, 0),
        });

        const d1 = tradingDays[0] ? buildDayStats(byDate.get(tradingDays[0])!) : null;
        const d2 = tradingDays[1] ? buildDayStats(byDate.get(tradingDays[1])!) : null;
        const d3 = tradingDays[2] ? buildDayStats(byDate.get(tradingDays[2])!) : null;

        const prevDay: PreviousDayContext | null = d1
          ? {
              close: d1.close,
              high: d1.high,
              low: d1.low,
              averageMinVolume: d1.avgVol,
              close2: d2?.close ?? null,
              high2: d2?.high ?? null,
              low2: d2?.low ?? null,
              close3: d3?.close ?? null,
              high3: d3?.high ?? null,
              low3: d3?.low ?? null,
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
}
