import "../config/env.ts";
import { now } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import FirebaseClient from "../firebase/client.ts";

const logger = createLogger("cmd:predict");

/**
 * Queue prediction requests for ALL enabled stocks (today's date).
 * The actual prediction is handled by the request-handler via request_queue.
 *
 * Usage: pnpm predict
 */
export async function handlePredict(): Promise<void> {
  const firebase = new FirebaseClient();

  const stocks = await firebase.getAllStocks();
  const enabledSymbols = Object.values(stocks)
    .filter((s) => s.enabled && s.currentProductionVersion)
    .map((s) => s.symbol);

  if (enabledSymbols.length === 0) {
    logger.info("No enabled stocks with production models to predict");
    return;
  }

  const today = now().format("YYYY-MM-DD");

  for (const sym of enabledSymbols) {
    await firebase.pushRequest({
      type: "predict",
      payload: { symbol: sym, fromDate: today, toDate: today },
    });
    logger.info(`✓ Queued prediction for ${sym} (${today})`);
  }

  logger.info(`Queued ${enabledSymbols.length} prediction request(s)`);
}
