import createLogger from "./logger.ts";

const log = createLogger("retry");

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a flaky operation with exponential backoff and full jitter -- each retry waits a
 * random duration between 0 and the capped exponential delay (AWS's "full jitter" formula),
 * rather than a fixed or purely exponential delay. This avoids hammering an already-struggling
 * upstream in a tight loop, and avoids every retry landing in lockstep when several requests
 * fail around the same time (observed on BSE's API, which intermittently sends malformed
 * headers under sustained load).
 */
export default async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
      const cappedDelay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
      const jittered = Math.random() * cappedDelay;
      log.info(`Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${Math.round(jittered)}ms`, err);
      await delay(jittered);
    }
  }
  log.error(`All ${maxRetries + 1} attempts failed`, lastError);
  throw lastError;
}
