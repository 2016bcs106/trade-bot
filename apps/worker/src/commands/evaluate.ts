import "../config/env.ts";
import { now } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import FirebaseClient from "../firebase/client.ts";

const logger = createLogger("cmd:evaluate");

/**
 * Queue evaluation requests for ALL enabled stocks (today's date).
 * The actual evaluation is handled by the request-handler via request_queue.
 *
 * Usage: pnpm evaluate
 */
export async function handleEvaluate(): Promise<void> {
  const firebase = new FirebaseClient();

  const stocks = await firebase.getAllStocks();
  const enabledSymbols = Object.values(stocks)
    .filter((s) => s.enabled)
    .map((s) => s.symbol);

  if (enabledSymbols.length === 0) {
    logger.info("No enabled stocks to evaluate");
    return;
  }

  const today = now().format("YYYY-MM-DD");

  for (const sym of enabledSymbols) {
    await firebase.pushRequest({
      type: "evaluate",
      payload: { symbol: sym, date: today },
    });
    logger.info(`✓ Queued evaluation for ${sym} (${today})`);
  }

  logger.info(`Queued ${enabledSymbols.length} evaluation request(s)`);
}
