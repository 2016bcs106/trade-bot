import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDate } from "./time.ts";
import { OHLCV } from "../types/market-data/ohlcv.ts";
import { Prediction } from "../types/predictions/prediction.ts";
import { EvaluationResult } from "../types/predictions/evaluation-result.ts";
import EvaluationEngine from "../evaluation/evaluation-engine.ts";
import FirebaseClient from "../firebase/client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "..", "data");

/**
 * Expand a date range into business days (Mon-Fri).
 */
export function getBusinessDays(fromDate: string, toDate: string): string[] {
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

/**
 * Compute actual high/low/close from full-day OHLCV candles.
 * Returns null if insufficient data (< 100 candles — market likely not closed).
 */
export function computeActuals(candles: OHLCV[]): { actualHigh: number; actualLow: number; actualClose: number } | null {
  if (candles.length < 100) return null;

  return {
    actualHigh: Math.max(...candles.map((c) => c.high)),
    actualLow: Math.min(...candles.map((c) => c.low)),
    actualClose: candles[candles.length - 1].close,
  };
}

/**
 * Evaluate a prediction against actuals and save to Firebase.
 * Fills in actual values, marks as evaluated, computes metrics, and persists.
 *
 * @returns The evaluation result, or null if actuals couldn't be computed.
 */
export async function evaluateAndSave(
  prediction: Prediction,
  candles: OHLCV[],
  firebase: FirebaseClient,
  symbol: string,
  date: string,
): Promise<EvaluationResult | null> {
  const actuals = computeActuals(candles);
  if (!actuals) return null;

  prediction.actualHigh = actuals.actualHigh;
  prediction.actualLow = actuals.actualLow;
  prediction.actualClose = actuals.actualClose;
  prediction.evaluated = true;

  const engine = new EvaluationEngine();
  const result = engine.evaluate(prediction);

  await firebase.setPrediction(symbol, date, prediction);
  if (result) {
    await firebase.setEvaluation(symbol, date, result);
  }

  return result;
}

/**
 * Load candles from local file written by minute-tick-collector.
 * File: data/{SYMBOL}.json — JSON array of OHLCV candles for today.
 * Filters to only return candles matching the requested date.
 */
export function loadLocalCandles(symbol: string, date: string): OHLCV[] {
  const filePath = resolve(DATA_DIR, `${symbol}.json`);

  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const candles: OHLCV[] = JSON.parse(content);
    return candles.filter((c) => c.timestamp.startsWith(date));
  } catch {
    return [];
  }
}
