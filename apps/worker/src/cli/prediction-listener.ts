import "../config/env.ts";
import moment from "moment";
import createLogger from "../utils/logger.ts";
import FirebaseClient, { PendingPredictionEntry } from "../firebase/client.ts";
import ModelManager from "../model-management/model-manager.ts";
import PredictionEngine from "../prediction/prediction-engine.ts";
import PaytmMoneyHistoricalProvider from "../data/providers/paytm-money-historical-provider.ts";
import { PreviousDayContext } from "../types/features/feature-vector.ts";
import { ScriptStatus } from "../types/script-status.ts";

const SCRIPT_NAME = "prediction-listener";
const HEARTBEAT_INTERVAL_MS = 60_000;
const logger = createLogger(SCRIPT_NAME);

let processedCount = 0;
let currentTask: string | null = null;

/**
 * Long-running listener that watches `pending_predictions/` in Firebase.
 * When a new entry is added (status=pending), it expands the date range
 * into business days and generates predictions for each.
 *
 * Emits heartbeat every 60s to scripts/<SCRIPT_NAME>.
 *
 * Usage: pnpm prediction-listener
 */
async function main(): Promise<void> {
  const firebase = new FirebaseClient();
  const modelManager = new ModelManager();
  const predictionEngine = new PredictionEngine();
  const provider = new PaytmMoneyHistoricalProvider();

  const startedAt = moment().utcOffset("+05:30").valueOf();

  // ─── Heartbeat ──────────────────────────────────────────────────────
  const reportStatus = async (status: ScriptStatus["status"], error: string | null = null) => {
    const payload: ScriptStatus = {
      status,
      lastHeartbeat: moment().utcOffset("+05:30").valueOf(),
      startedAt,
      error,
      metadata: { processedCount, currentTask },
    };
    try {
      await firebase.updateScriptStatus(SCRIPT_NAME, payload);
    } catch (err) {
      logger.error(`Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  await reportStatus("running");
  const heartbeatTimer = setInterval(() => reportStatus("running"), HEARTBEAT_INTERVAL_MS);

  // ─── Graceful Shutdown ──────────────────────────────────────────────
  const shutdown = async (reason: string) => {
    logger.info(`Shutting down — reason=${reason}`);
    clearInterval(heartbeatTimer);
    await reportStatus("stopped");
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info("Prediction listener started — watching pending_predictions/");

  // First, process any existing pending entries
  const existing = await firebase.getAllPendingPredictions();
  const pendingKeys = Object.entries(existing)
    .filter(([, e]) => e.status === "pending")
    .map(([key]) => key);

  if (pendingKeys.length > 0) {
    logger.info(`Found ${pendingKeys.length} existing pending entries — processing...`);
    for (const key of pendingKeys) {
      await processEntry(key, existing[key], firebase, modelManager, predictionEngine, provider);
    }
  }

  // Then listen for new additions
  firebase.onPendingPredictionAdded(async (key, entry) => {
    if (entry.status !== "pending") return;
    logger.info(`New pending prediction: ${entry.symbol} ${entry.fromDate} → ${entry.toDate}`);
    await processEntry(key, entry, firebase, modelManager, predictionEngine, provider);
  });

  // Keep process alive
  logger.info("Listening for new pending predictions... (Ctrl+C to stop)");
}

/**
 * Expand a date range into business days (Mon-Fri) and returns YYYY-MM-DD strings.
 */
function getBusinessDays(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  const start = moment(fromDate, "YYYY-MM-DD");
  const end = moment(toDate, "YYYY-MM-DD");

  for (let d = start.clone(); d.isSameOrBefore(end); d.add(1, "day")) {
    const dow = d.day();
    if (dow !== 0 && dow !== 6) {
      dates.push(d.format("YYYY-MM-DD"));
    }
  }
  return dates;
}

async function processEntry(
  key: string,
  entry: PendingPredictionEntry,
  firebase: FirebaseClient,
  modelManager: ModelManager,
  predictionEngine: PredictionEngine,
  provider: PaytmMoneyHistoricalProvider,
): Promise<void> {
  const { symbol, fromDate, toDate } = entry;
  currentTask = `${symbol} ${fromDate}→${toDate}`;

  try {
    const dates = getBusinessDays(fromDate, toDate);
    if (dates.length === 0) {
      await firebase.removePendingPrediction(key);
      logger.info(`No business days in range ${fromDate} → ${toDate} — removed`);
      return;
    }

    // Mark as processing with total count
    await firebase.updatePendingPrediction(key, {
      status: "processing",
      totalDates: dates.length,
      processedDates: 0,
    });

    const stock = await firebase.getStock(symbol);
    if (!stock || !stock.currentProductionVersion) {
      throw new Error(`No production model for ${symbol}`);
    }

    const pmlId = stock.pmlId;
    if (!pmlId) {
      throw new Error(`Stock ${symbol} has no pmlId`);
    }

    const metadata = modelManager.loadMetadata(symbol, stock.currentProductionVersion);
    const modelType = metadata?.modelType || "linear-regression";

    let processed = 0;

    for (const date of dates) {
      try {
        // Fetch candles for the target date
        const candles = await provider.fetchOHLCV({
          symbol, securityId: pmlId, exchange: "NSE",
          fromDate: date, toDate: date, interval: "MINUTE",
        });

        if (candles.length < 30) {
          logger.warn(`Skipping ${symbol}@${date}: only ${candles.length} candles (need ≥30)`);
          processed++;
          continue;
        }

        // Fetch previous day candles
        const prevDate = moment(date).subtract(1, "day").format("YYYY-MM-DD");
        const prevCandles = await provider.fetchOHLCV({
          symbol, securityId: pmlId, exchange: "NSE",
          fromDate: prevDate, toDate: prevDate, interval: "MINUTE",
        });

        const prevDay: PreviousDayContext | null = prevCandles.length > 0
          ? {
              close: prevCandles[prevCandles.length - 1].close,
              high: Math.max(...prevCandles.map((c) => c.high)),
              avg45MinVolume: prevCandles.slice(0, 105).reduce((s, c) => s + c.volume, 0),
              close2: null, high2: null, close3: null, high3: null,
            }
          : null;

        // Generate prediction
        const prediction = predictionEngine.predict(
          symbol, date, candles, prevDay, stock.currentProductionVersion, modelType,
        );

        if (prediction) {
          // If market is closed for this date (date is in the past), add actual high/low
          const now = moment().utcOffset("+05:30");
          const predDate = moment(date, "YYYY-MM-DD");
          const marketCloseTime = predDate.clone().hour(15).minute(30);
          if (now.isAfter(marketCloseTime)) {
            // Use full day candles to compute actual high/low
            const actualHigh = Math.max(...candles.map((c) => c.high));
            const actualLow = Math.min(...candles.map((c) => c.low));
            prediction.actualHigh = actualHigh;
            prediction.actualLow = actualLow;
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
      await firebase.updatePendingPrediction(key, { processedDates: processed });
    }

    // All done — remove from queue
    await firebase.removePendingPrediction(key);
    processedCount += processed;
    currentTask = null;
    logger.info(`✓ Completed ${symbol} range: ${fromDate} → ${toDate} (${processed}/${dates.length} dates)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`✗ ${symbol} ${fromDate}→${toDate}: ${msg}`);
    await firebase.updatePendingPrediction(key, { status: "failed", error: msg });
    currentTask = null;
  }
}

main().catch((e) => {
  logger.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
