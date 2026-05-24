import { now, parseDate } from "../utils/time.ts";
import BaseScript from "./base-script.ts";
import { PendingPredictionEntry } from "../firebase/client.ts";
import ModelManager from "../model-management/model-manager.ts";
import PredictionEngine from "../prediction/prediction-engine.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";
import { PreviousDayContext } from "../types/features/feature-vector.ts";

/**
 * Long-running listener that watches `pending_predictions/` in Firebase.
 * When a new entry is added (status=pending), it expands the date range
 * into business days and generates predictions for each.
 *
 * Usage: pnpm prediction-listener
 */
class PredictionListenerScript extends BaseScript {
  private processedCount = 0;
  private currentTask: string | null = null;
  private modelManager!: ModelManager;
  private predictionEngine!: PredictionEngine;
  private client!: PaytmMoneyClient;

  get scriptName(): string {
    return "prediction-listener";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      processedCount: this.processedCount,
      currentTask: this.currentTask,
    };
  }

  protected async run(): Promise<void> {
    this.modelManager = new ModelManager();
    this.predictionEngine = new PredictionEngine();
    this.client = new PaytmMoneyClient();

    this.log.info("Prediction listener started — watching pending_predictions/");

    // First, process any existing entries (regardless of status)
    const existing = await this.firebase.getAllPendingPredictions();
    const existingKeys = Object.keys(existing);

    if (existingKeys.length > 0) {
      this.log.info(`Found ${existingKeys.length} existing entries — processing...`);
      for (const key of existingKeys) {
        await this.processEntry(key, existing[key]);
      }
    }

    // Then listen for new additions (process all, no status filter)
    this.firebase.onPendingPredictionAdded(async (key, entry) => {
      this.log.info(`New pending prediction: ${entry.symbol} ${entry.fromDate} → ${entry.toDate}`);
      await this.processEntry(key, entry);
    });

    // Keep process alive
    this.log.info("Listening for new pending predictions... (Ctrl+C to stop)");
    await new Promise(() => {});
  }

  private async processEntry(key: string, entry: PendingPredictionEntry): Promise<void> {
    const { symbol, fromDate, toDate } = entry;
    this.currentTask = `${symbol} ${fromDate}→${toDate}`;

    try {
      const dates = this.getBusinessDays(fromDate, toDate);
      if (dates.length === 0) {
        await this.firebase.removePendingPrediction(key);
        this.log.info(`No business days in range ${fromDate} → ${toDate} — removed`);
        return;
      }

      // Mark as processing with total count
      await this.firebase.updatePendingPrediction(key, {
        status: "processing",
        totalDates: dates.length,
        processedDates: 0,
      });

      const stock = await this.firebase.getStock(symbol);
      if (!stock || !stock.currentProductionVersion) {
        throw new Error(`No production model for ${symbol}`);
      }

      const pmlId = stock.pmlId;
      if (!pmlId) {
        throw new Error(`Stock ${symbol} has no pmlId`);
      }

      const metadata = this.modelManager.loadMetadata(symbol, stock.currentProductionVersion);
      const modelType = metadata?.modelType || "linear-regression";

      let processed = 0;

      for (const date of dates) {
        try {
          // Fetch candles for the target date
          const candles = await this.client.fetchOHLCV(pmlId, date, date);

          if (candles.length < 30) {
            this.log.warn(`Skipping ${symbol}@${date}: only ${candles.length} candles (need ≥30)`);
            processed++;
            continue;
          }

          // Fetch previous day candles
          const prevDate = parseDate(date).subtract(1, "day").format("YYYY-MM-DD");
          const prevCandles = await this.client.fetchOHLCV(pmlId, prevDate, prevDate);

          const prevDay: PreviousDayContext | null = prevCandles.length > 0
            ? {
                close: prevCandles[prevCandles.length - 1].close,
                high: Math.max(...prevCandles.map((c) => c.high)),
                avg45MinVolume: prevCandles.slice(0, 105).reduce((s, c) => s + c.volume, 0),
                close2: null, high2: null, close3: null, high3: null,
              }
            : null;

          // Generate prediction
          const prediction = this.predictionEngine.predict(
            symbol, date, candles, prevDay, stock.currentProductionVersion, modelType,
          );

          if (prediction) {
            // If market is closed for this date (past), add actual high/low
            const current = now();
            const predDate = parseDate(date, "YYYY-MM-DD");
            const marketCloseTime = predDate.clone().hour(15).minute(30);
            if (current.isAfter(marketCloseTime)) {
              const actualHigh = Math.max(...candles.map((c) => c.high));
              const actualLow = Math.min(...candles.map((c) => c.low));
              const actualClose = candles[candles.length - 1].close;
              prediction.actualHigh = actualHigh;
              prediction.actualLow = actualLow;
              prediction.actualClose = actualClose;
              prediction.evaluated = true;
            }

            await this.firebase.setPrediction(symbol, date, prediction);
            const actualStr = prediction.evaluated
              ? ` | Actual H=${prediction.actualHigh?.toFixed(2)} L=${prediction.actualLow?.toFixed(2)}`
              : "";
            this.log.info(`✓ ${symbol}@${date}: HIGH=${prediction.predictedHigh.toFixed(2)}, LOW=${prediction.predictedLow.toFixed(2)}${actualStr}`);
          } else {
            this.log.warn(`Prediction returned null for ${symbol}@${date}`);
          }
        } catch (dateErr) {
          const msg = dateErr instanceof Error ? dateErr.message : String(dateErr);
          this.log.error(`✗ ${symbol}@${date}: ${msg}`);
        }

        processed++;
        await this.firebase.updatePendingPrediction(key, { processedDates: processed });
      }

      // All done — remove from queue
      await this.firebase.removePendingPrediction(key);
      this.processedCount += processed;
      this.currentTask = null;
      this.log.info(`✓ Completed ${symbol} range: ${fromDate} → ${toDate} (${processed}/${dates.length} dates)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`✗ ${symbol} ${fromDate}→${toDate}: ${msg}`);
      await this.firebase.updatePendingPrediction(key, { status: "failed", error: msg });
      this.currentTask = null;
    }
  }

  /**
   * Expand a date range into business days (Mon-Fri).
   */
  private getBusinessDays(fromDate: string, toDate: string): string[] {
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
}

new PredictionListenerScript().start();
