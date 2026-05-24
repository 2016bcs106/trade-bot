import FirebaseClient, { QueuedRequest } from "../firebase/client.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";
import ModelTrainer from "../training/model-trainer.ts";
import ModelManager from "../model-management/model-manager.ts";
import PredictionEngine from "../prediction/prediction-engine.ts";

/**
 * Shared service context — instantiated once in the orchestration script
 * and passed to all request handlers to avoid redundant instantiation.
 */
export interface ServiceContext {
  firebase: FirebaseClient;
  paytm: PaytmMoneyClient;
  trainer: ModelTrainer;
  modelManager: ModelManager;
  predictionEngine: PredictionEngine;
}

/**
 * Create the shared service context (call once at startup).
 */
export function createServiceContext(): ServiceContext {
  const firebase = new FirebaseClient();
  const paytm = new PaytmMoneyClient();
  const trainer = new ModelTrainer(paytm);
  const modelManager = new ModelManager();
  const predictionEngine = new PredictionEngine();
  return { firebase, paytm, trainer, modelManager, predictionEngine };
}

/**
 * Base interface for all request handlers.
 * Each handler processes a specific request type from the request_queue.
 */
export interface RequestHandler {
  /** Handle the request. Throws on failure. */
  handle(request: QueuedRequest, ctx: ServiceContext): Promise<void>;
}
