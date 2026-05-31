import FirebaseClient, { QueuedRequest } from "../firebase/client.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";
import { Logger } from "../types/logger.ts";

export interface ServiceContext {
  firebase: FirebaseClient;
  paytm: PaytmMoneyClient;
  log: Logger;
}

export function createServiceContext(log: Logger): ServiceContext {
  const firebase = new FirebaseClient();
  const paytm = new PaytmMoneyClient();
  return { firebase, paytm, log };
}

export interface RequestHandler {
  handle(request: QueuedRequest, ctx: ServiceContext): Promise<void>;
}
