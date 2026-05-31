import FirebaseClient, { QueuedRequest } from "../firebase/client.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";

/**
 * Shared service context — instantiated once in the orchestration script
 * and passed to all request handlers to avoid redundant instantiation.
 */
export interface ServiceContext {
  firebase: FirebaseClient;
  paytm: PaytmMoneyClient;
}

/**
 * Create the shared service context (call once at startup).
 */
export function createServiceContext(): ServiceContext {
  const firebase = new FirebaseClient();
  const paytm = new PaytmMoneyClient();
  return { firebase, paytm };
}

/**
 * Base interface for all request handlers.
 * Each handler processes a specific request type from the request_queue.
 */
export interface RequestHandler {
  /** Handle the request. Throws on failure. */
  handle(request: QueuedRequest, ctx: ServiceContext): Promise<void>;
}
