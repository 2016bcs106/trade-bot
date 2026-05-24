import { QueuedRequest } from "../firebase/client.ts";

/**
 * Base interface for all request handlers.
 * Each handler processes a specific request type from the request_queue.
 */
export interface RequestHandler {
  /** Handle the request. Throws on failure. */
  handle(request: QueuedRequest): Promise<void>;
}
