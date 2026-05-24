import BaseScript from "./base-script.ts";
import { QueuedRequest } from "../firebase/client.ts";

/**
 * Long-running script that listens to `request_queue/` in Firebase
 * and processes requests sequentially.
 *
 * Behavior:
 * - Listens via onValue (fires on any change to the collection)
 * - Ignores delete events (key disappears from snapshot)
 * - Processes new requests one at a time in arrival order
 * - On success: deletes the entry from request_queue/
 * - On failure: moves entry to failed_requests/ with error info
 *
 * Usage: pnpm request-handler
 */
class RequestHandlerScript extends BaseScript {
  private processedCount = 0;
  private failedCount = 0;
  private currentRequest: string | null = null;
  private processing = false;
  private pendingKeys: string[] = [];
  private knownKeys = new Set<string>();

  get scriptName(): string {
    return "request-handler";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      processedCount: this.processedCount,
      failedCount: this.failedCount,
      currentRequest: this.currentRequest,
      queueLength: this.pendingKeys.length,
    };
  }

  protected async run(): Promise<void> {
    this.log.info("Request handler started — watching request_queue/");

    this.firebase.onRequestQueueChanged((data) => {
      if (!data) {
        // Collection empty or deleted — reset known keys
        this.knownKeys.clear();
        return;
      }

      // Find new keys that we haven't processed/seen yet
      const currentKeys = Object.keys(data);
      const newKeys = currentKeys.filter((k) => !this.knownKeys.has(k));

      // Update known keys to current snapshot
      this.knownKeys = new Set(currentKeys);

      if (newKeys.length === 0) {
        // This was a delete or status update — ignore
        return;
      }

      // Queue new requests for sequential processing
      for (const key of newKeys) {
        this.log.info(`Queued: ${key} (type: ${data[key].type})`);
        this.pendingKeys.push(key);
      }

      this.processNext();
    });

    // Keep process alive
    await new Promise(() => {});
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.pendingKeys.length === 0) return;

    this.processing = true;

    while (this.pendingKeys.length > 0) {
      const key = this.pendingKeys.shift()!;
      await this.handleRequest(key);
    }

    this.processing = false;
  }

  private async handleRequest(key: string): Promise<void> {
    try {
      const request = await this.firebase.getRequest(key);
      if (!request) {
        // Entry was already deleted (race condition) — skip
        this.knownKeys.delete(key);
        return;
      }

      this.currentRequest = `${request.type} (${key})`;
      this.log.info(`Processing: ${request.type} [${key}]`);

      // Mark as processing
      await this.firebase.updateRequestStatus(key, "processing");

      // Dispatch to handler
      await this.dispatch(request);

      // Success — remove from queue
      await this.firebase.removeRequest(key);
      this.knownKeys.delete(key);
      this.processedCount++;
      this.log.info(`✓ Completed: ${request.type} [${key}]`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.log.error(`✗ Failed: ${key} — ${errorMessage}`);

      // Move to failed_requests/
      try {
        await this.firebase.moveRequestToFailed(key, errorMessage);
        this.knownKeys.delete(key);
      } catch (moveErr) {
        this.log.error(`Failed to move request to failed_requests: ${moveErr}`);
      }

      this.failedCount++;
    } finally {
      this.currentRequest = null;
    }
  }

  /**
   * Dispatch a request to the appropriate handler based on type.
   *
   * TODO: Implement handlers for each request type:
   * - "train" → trigger model training
   * - "predict" → generate predictions
   * - "evaluate" → run evaluation
   * - "add_stock" → add a stock to tracking
   * - "remove_stock" → remove a stock
   * - "promote_model" → promote a model version
   * - "rollback_model" → rollback to previous version
   */
  private async dispatch(request: QueuedRequest): Promise<void> {
    switch (request.type) {
      // TODO: Implement request handlers
      default:
        throw new Error(`Unknown request type: "${request.type}"`);
    }
  }
}

new RequestHandlerScript().start();
