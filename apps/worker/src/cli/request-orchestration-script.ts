import BaseScript from "./base-script.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { RequestHandler } from "../request-handlers/request-handler.ts";
import { PredictionRequestHandler } from "../request-handlers/prediction-request-handler.ts";

/**
 * Registry: maps request type → handler instance.
 */
const handlerRegistry: Record<string, RequestHandler> = {
  predict: new PredictionRequestHandler(),
  // TODO: Register additional handlers here
  // train: new TrainingRequestHandler(),
  // evaluate: new EvaluationRequestHandler(),
};

/**
 * Long-running script that listens to `request_queue/` in Firebase
 * and processes requests sequentially using registered handlers.
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
class RequestOrchestrationScript extends BaseScript {
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
    this.log.info("Request orchestration started — watching request_queue/");

    this.firebase.onRequestQueueChanged((data) => {
      if (!data) {
        this.knownKeys.clear();
        return;
      }

      const currentKeys = Object.keys(data);
      const newKeys = currentKeys.filter((k) => !this.knownKeys.has(k));

      this.knownKeys = new Set(currentKeys);

      if (newKeys.length === 0) return;

      for (const key of newKeys) {
        this.log.info(`Queued: ${key} (type: ${data[key].type})`);
        this.pendingKeys.push(key);
      }

      this.processNext();
    });

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
        this.knownKeys.delete(key);
        return;
      }

      this.currentRequest = `${request.type} (${key})`;
      this.log.info(`Processing: ${request.type} [${key}]`);

      await this.firebase.updateRequestStatus(key, "processing");

      await this.dispatch(request);

      await this.firebase.removeRequest(key);
      this.knownKeys.delete(key);
      this.processedCount++;
      this.log.info(`✓ Completed: ${request.type} [${key}]`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.log.error(`✗ Failed: ${key} — ${errorMessage}`);

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

  private async dispatch(request: QueuedRequest): Promise<void> {
    const handler = handlerRegistry[request.type];
    if (!handler) {
      throw new Error(`Unknown request type: "${request.type}" — no handler registered`);
    }
    await handler.handle(request);
  }
}

new RequestOrchestrationScript().start();
