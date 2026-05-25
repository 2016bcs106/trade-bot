import { now, parseDate, nowFormatted } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { PreviousDayContext } from "../types/features/feature-vector.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";
import { getBusinessDays, evaluateAndSave, loadLocalCandles } from "../utils/market-utils.ts";

const logger = createLogger("handler:predict");

/** Market opens at 9:15 AM IST */
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MIN = 15;

/**
 * Handles "predict" requests — generates/updates predictions for a stock.
 *
 * Rolling Forecast Mode (default for today):
 * - Computes minutes elapsed since market open (9:15 AM)
 * - Rounds down to nearest 5 to get the horizon
 * - Uses horizon-specific model (model-{horizon}.json) if available
 * - Preserves original `generatedAt`, updates `updatedAt`
 *
 * Historical Mode (for past dates):
 * - Uses all available candles for that day
 * - Window size = number of candles available (capped at 375)
 *
 * Expected payload:
 * - symbol: string (stock symbol)
 * - fromDate: string (YYYY-MM-DD)
 * - toDate: string (YYYY-MM-DD)
 * - predictAt?: string (HH:mm format, e.g. "11:00") — simulate prediction at this time
 *     Converts to minutes since 9:15 AM to select the right horizon model.
 *     If omitted: today uses real elapsed time, historical uses all available candles.
 * - dataSource?: "api" | "local" (default: "api")
 */
export class PredictionRequestHandler implements RequestHandler {
  async handle(request: QueuedRequest, ctx: ServiceContext): Promise<void> {
    const { symbol, fromDate, toDate, predictAt, dataSource = "api" } = request.payload as {
      symbol: string;
      fromDate: string;
      toDate: string;
      predictAt?: string;
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
    const version = stock.currentProductionVersion;
    const metadata = modelManager.loadMetadata(symbol, version);
    const modelType = metadata?.modelType || "linear-regression";

    logger.info(`Predicting ${symbol}: ${fromDate} → ${toDate} (${dates.length} days, source=${dataSource})`);

    let processed = 0;

    for (const date of dates) {
      try {
        const candles = dataSource === "local"
          ? loadLocalCandles(symbol, date)
          : await client.fetchOHLCV(pmlId, date, date);

        if (candles.length < 5) {
          logger.warn(`Skipping ${symbol}@${date}: only ${candles.length} candles (need ≥5)`);
          processed++;
          continue;
        }

        // Determine window size based on whether this is a live or historical prediction
        const windowSize = this.computeWindowSize(date, candles.length, predictAt);

        if (candles.length < windowSize) {
          logger.warn(`Skipping ${symbol}@${date}: only ${candles.length} candles (need ${windowSize})`);
          processed++;
          continue;
        }

        // Build previous day context
        const prevDay = await this.buildPrevDayContext(pmlId, date, client);

        const prediction = predictionEngine.predict(
          symbol, date, candles, prevDay, version, modelType, windowSize,
        );

        if (prediction) {
          // Preserve original generatedAt on rolling updates
          const existing = await firebase.getPrediction(symbol, date);
          if (existing) {
            prediction.generatedAt = existing.generatedAt;
          }
          prediction.updatedAt = nowFormatted();

          // If market is closed for this date (past), evaluate inline
          const current = now();
          const predDate = parseDate(date, "YYYY-MM-DD");
          const marketCloseTime = predDate.clone().hour(15).minute(30);

          if (current.isAfter(marketCloseTime)) {
            const result = await evaluateAndSave(prediction, candles, firebase, symbol, date);
            const actualStr = result
              ? ` | Actual H=${prediction.actualHigh?.toFixed(2)} L=${prediction.actualLow?.toFixed(2)}`
              : "";
            logger.info(`✓ ${symbol}@${date}: H=${prediction.predictedHigh.toFixed(2)} L=${prediction.predictedLow.toFixed(2)} C=${prediction.predictedClose.toFixed(2)} (w=${windowSize})${actualStr}`);
          } else {
            await firebase.setPrediction(symbol, date, prediction);
            logger.info(`✓ ${symbol}@${date}: H=${prediction.predictedHigh.toFixed(2)} L=${prediction.predictedLow.toFixed(2)} C=${prediction.predictedClose.toFixed(2)} (w=${windowSize})`);
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
   * Compute window size for a given date:
   * - If predictAt is provided (HH:mm): compute minutes from 9:15 to that time
   * - For today (live): minutes elapsed since 9:15 AM, rounded down to nearest 5
   * - For past dates (no predictAt): use all available candles (capped at 375)
   */
  private computeWindowSize(date: string, availableCandles: number, predictAt?: string): number {
    // If predictAt is provided, convert "HH:mm" to minutes since 9:15
    if (predictAt) {
      const [hh, mm] = predictAt.split(":").map(Number);
      const minutesSinceOpen = (hh * 60 + mm) - (MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MIN);
      const horizon = Math.floor(minutesSinceOpen / 5) * 5;
      return Math.max(5, Math.min(horizon, availableCandles));
    }

    const current = now();
    const today = current.format("YYYY-MM-DD");

    if (date === today) {
      // Live rolling forecast: use elapsed minutes since market open
      const marketOpen = current.clone().hour(MARKET_OPEN_HOUR).minute(MARKET_OPEN_MIN).second(0);
      const minutesElapsed = current.diff(marketOpen, "minutes");
      const horizon = Math.floor(minutesElapsed / 5) * 5;
      // Minimum 5, maximum = available candles
      return Math.max(5, Math.min(horizon, availableCandles));
    }

    // Historical: use all available candles (full day = 375 max)
    return Math.min(availableCandles, 375);
  }

  /**
   * Build previous day context from last 3 trading days.
   */
  private async buildPrevDayContext(
    pmlId: string,
    date: string,
    client: { fetchOHLCV: (id: string, from: string, to: string, interval?: "MINUTE" | "DAY") => Promise<any[]> },
  ): Promise<PreviousDayContext | null> {
    try {
      const prev7Start = parseDate(date).subtract(7, "day").format("YYYY-MM-DD");
      const prevDateEnd = parseDate(date).subtract(1, "day").format("YYYY-MM-DD");
      const prevCandles = await client.fetchOHLCV(pmlId, prev7Start, prevDateEnd);

      if (prevCandles.length === 0) return null;

      const byDate = new Map<string, typeof prevCandles>();
      for (const c of prevCandles) {
        const d = c.timestamp.split(" ")[0];
        const existing = byDate.get(d) || [];
        existing.push(c);
        byDate.set(d, existing);
      }
      const tradingDays = [...byDate.keys()].sort().reverse();

      const buildDayStats = (dayCandles: typeof prevCandles) => ({
        close: dayCandles[dayCandles.length - 1].close,
        high: Math.max(...dayCandles.map((c) => c.high)),
        low: Math.min(...dayCandles.map((c) => c.low)),
        avgVol: dayCandles.slice(0, 105).reduce((s, c) => s + c.volume, 0),
      });

      const d1 = tradingDays[0] ? buildDayStats(byDate.get(tradingDays[0])!) : null;
      const d2 = tradingDays[1] ? buildDayStats(byDate.get(tradingDays[1])!) : null;
      const d3 = tradingDays[2] ? buildDayStats(byDate.get(tradingDays[2])!) : null;

      if (!d1) return null;

      return {
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
      };
    } catch {
      return null;
    }
  }
}
