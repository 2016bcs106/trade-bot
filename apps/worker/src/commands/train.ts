import "../config/env.ts";
import createLogger from "../utils/logger.ts";
import FirebaseClient from "../firebase/client.ts";

const logger = createLogger("cmd:train");

/**
 * Queue training requests for ALL enabled stocks.
 * The actual training is handled by the request-handler via request_queue.
 *
 * Usage: pnpm train
 */
export async function handleTrain(): Promise<void> {
  const firebase = new FirebaseClient();

  const stocks = await firebase.getAllStocks();
  const enabledSymbols = Object.values(stocks)
    .filter((s) => s.enabled)
    .map((s) => s.symbol);

  if (enabledSymbols.length === 0) {
    logger.info("No enabled stocks to train");
    return;
  }

  for (const sym of enabledSymbols) {
    await firebase.pushRequest({
      type: "train",
      payload: { symbol: sym },
    });
    logger.info(`✓ Queued training for ${sym}`);
  }

  logger.info(`Queued ${enabledSymbols.length} training request(s)`);
}
