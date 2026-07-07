import "../config/env.ts";
import { nowISO } from "../utils/time.ts";
import { initializeApp, deleteApp } from "firebase/app";
import { getDatabase, ref, get, set, push, remove, onValue, Database, Unsubscribe } from "firebase/database";
import { SaveAccessTokensPayload } from "../types/auth/save-access-tokens-payload.ts";
import { ScriptStatus } from "../types/script-status.ts";
import { StockConfig } from "../types/stocks/index.ts";
import { PushSubscriptionData } from "../types/push-subscription.ts";
import { PortfolioHoldings, PortfolioPositions, FundsSummary } from "../types/market-data/portfolio.ts";
import { SignalsSummary } from "../types/signals-summary.ts";

const app = initializeApp({
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = getDatabase(app);

/**
 * Centralized Firebase Realtime Database client.
 * Handles initialization and all read/write operations.
 */
export default class FirebaseClient {
  private db: Database;

  constructor() {
    this.db = db;
  }

  // ─── Auth Tokens ──────────────────────────────────────────────────

  async getAccessToken(): Promise<string> {
    const data = await this._getValue("auth/accessToken") as { token?: string } | null;
    if (!data?.token) {
      throw new Error("No accessToken found in Firebase. Login via the front-end first.");
    }
    return data.token;
  }

  async getPublicAccessToken(): Promise<string> {
    const data = await this._getValue("auth/publicAccessToken") as { token?: string } | null;
    if (!data?.token) {
      throw new Error("No publicAccessToken found in Firebase.");
    }
    return data.token;
  }

  onAccessTokenChange(callback: (token: string) => void): Unsubscribe {
    return this._onChange("auth/accessToken", (data) => {
      const record = data as { token?: string } | null;
      if (record?.token) callback(record.token);
    });
  }

  onPublicAccessTokenChange(callback: (token: string) => void): Unsubscribe {
    return this._onChange("auth/publicAccessToken", (data) => {
      const record = data as { token?: string } | null;
      if (record?.token) callback(record.token);
    });
  }

  onRequestTokenChange(callback: (token: string) => void): Unsubscribe {
    return this._onChange("auth/requestToken", (data) => {
      const record = data as { token?: string } | null;
      if (record?.token) callback(record.token);
    });
  }

  async saveAccessTokens({ accessToken, publicAccessToken, readAccessToken, updatedOn }: SaveAccessTokensPayload): Promise<void> {
    await Promise.all([
      this._setValue("auth/accessToken", { token: accessToken, timestamp: updatedOn }),
      this._setValue("auth/publicAccessToken", { token: publicAccessToken, timestamp: updatedOn }),
      this._setValue("auth/readAccessToken", { token: readAccessToken, timestamp: updatedOn }),
      this._setValue("auth/updatedOn", updatedOn),
    ]);
  }

  async getAuthUpdatedOn(): Promise<string | null> {
    return (await this._getValue("auth/updatedOn")) as string | null;
  }

  // ─── Push Subscriptions ───────────────────────────────────────────

  async getPushSubscriptions(): Promise<Record<string, PushSubscriptionData>> {
    const data = await this._getValue("push_subscriptions");
    return (data as Record<string, PushSubscriptionData>) || {};
  }

  async removePushSubscription(key: string): Promise<void> {
    await this._remove(`push_subscriptions/${key}`);
  }

  // ─── Script Status ────────────────────────────────────────────────

  async updateScriptStatus(scriptName: string, status: ScriptStatus): Promise<void> {
    await this._setValue(`scripts/${scriptName}`, status);
  }


  // ─── Stocks ────────────────────────────────────────────────────────

  async getStock(symbol: string): Promise<StockConfig | null> {
    const data = await this._getValue(`stocks/${symbol}`);
    return data as StockConfig | null;
  }

  async getAllStocks(): Promise<Record<string, StockConfig>> {
    const data = await this._getValue("stocks");
    return (data as Record<string, StockConfig>) || {};
  }

  async setStock(symbol: string, config: StockConfig): Promise<void> {
    await this._setValue(`stocks/${symbol}`, config);
  }

  async updateStock(symbol: string, updates: Partial<StockConfig>): Promise<void> {
    const current = await this.getStock(symbol);
    if (!current) throw new Error(`Stock ${symbol} not found`);
    await this._setValue(`stocks/${symbol}`, { ...current, ...updates, updatedAt: nowISO() });
  }

  async removeStock(symbol: string): Promise<void> {
    await this._remove(`stocks/${symbol}`);
  }


  async setRecommendationData(symbol: string, strategyKey: string, data: Record<string, unknown>): Promise<void> {
    await this._setValue(`stocks/${symbol}/recommendationData/${strategyKey}`, data);
  }

  async setSignal(strategyKey: string, date: string, symbol: string, data: { signal: string; confidence: number }): Promise<void> {
    await this._setValue(`signals/${symbol}/${strategyKey}/${date}`, data);
  }

  async setSignalsSummary(data: SignalsSummary): Promise<void> {
    await this._setValue("signals_summary/latest", data);
  }

  async getSignalsSummary(): Promise<SignalsSummary | null> {
    return (await this._getValue("signals_summary/latest")) as SignalsSummary | null;
  }

  async setDhanSignalsSummary(data: SignalsSummary): Promise<void> {
    await this._setValue("dhanhq/signals_summary/latest", data);
  }

  async getDhanSignalsSummary(): Promise<SignalsSummary | null> {
    return (await this._getValue("dhanhq/signals_summary/latest")) as SignalsSummary | null;
  }

  // ─── Portfolio ─────────────────────────────────────────────────────

  async setPortfolioHoldings(data: PortfolioHoldings): Promise<void> {
    await this._setValue("portfolio/holdings", data);
  }

  async setPortfolioPositions(data: PortfolioPositions): Promise<void> {
    await this._setValue("portfolio/positions", data);
  }

  async setFundsSummary(data: FundsSummary): Promise<void> {
    await this._setValue("portfolio/funds", data);
  }

  async setDhanhqFundsSummary(data: FundsSummary): Promise<void> {
    await this._setValue("dhanhq/portfolio/funds", data);
  }

  async setDhanhqPortfolioHoldings(data: PortfolioHoldings): Promise<void> {
    await this._setValue("dhanhq/portfolio/holdings", data);
  }

  async setDhanhqPortfolioPositions(data: PortfolioPositions): Promise<void> {
    await this._setValue("dhanhq/portfolio/positions", data);
  }

  async getPortfolioHoldingSymbols(): Promise<Set<string>> {
    const data = await this._getValue("portfolio/holdings/items") as { symbol: string }[] | null;
    return new Set((data || []).map((item) => item.symbol));
  }

  async getDhanPortfolioHoldingSymbols(): Promise<Set<string>> {
    const data = await this._getValue("dhanhq/portfolio/holdings/items") as { symbol: string }[] | null;
    return new Set((data || []).map((item) => item.symbol));
  }

  onStocksChange(callback: (stocks: Record<string, StockConfig> | null) => void): Unsubscribe {
    return this._onChange("stocks", (value) => {
      callback(value as Record<string, StockConfig> | null);
    });
  }

  onMarketStatusChange(callback: (data: { status: string; tradeDate: string; updatedAt: string } | null) => void): Unsubscribe {
    return this._onChange("market_status", (value) => {
      callback(value as { status: string; tradeDate: string; updatedAt: string } | null);
    });
  }

  onFavoritesChange(callback: (data: Record<string, boolean> | null) => void): Unsubscribe {
    return this._onChange("favorites", (value) => {
      callback(value as Record<string, boolean> | null);
    });
  }

  async getConfig(key: string): Promise<unknown> {
    return this._getValue(`config/${key}`);
  }

  async destroy(): Promise<void> {
    await deleteApp(app);
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private async _getValue(path: string): Promise<unknown> {
    const snapshot = await get(ref(this.db, path));
    return snapshot.val();
  }

  async getValue(path: string): Promise<unknown> {
    return this._getValue(path);
  }

  async setValue(path: string, value: unknown): Promise<void> {
    await set(ref(this.db, path), value);
  }

  private async _setValue(path: string, value: unknown): Promise<void> {
    await set(ref(this.db, path), value);
  }

  private async _remove(path: string): Promise<void> {
    await remove(ref(this.db, path));
  }

  /**
   * Generic Firebase listener that deduplicates by serialized value.
   * Calls callback only when value actually changes.
   */
  private _onChange(path: string, callback: (value: unknown) => void): Unsubscribe {
    let previous: string | undefined = undefined;
    return onValue(ref(this.db, path), (snapshot) => {
      const value = snapshot.val();
      const serialized = JSON.stringify(value);
      if (serialized !== previous) {
        previous = serialized;
        callback(value);
      }
    });
  }


  // ─── Request Queue ─────────────────────────────────────────────────

  /**
   * Listen to the entire request_queue/ collection.
   * Fires callback with the full snapshot on every change (add/update/delete).
   * Returns unsubscribe function.
   */
  onRequestQueueChanged(callback: (data: Record<string, QueuedRequest> | null) => void): Unsubscribe {
    return onValue(ref(this.db, "request_queue"), (snapshot) => {
      callback(snapshot.val() as Record<string, QueuedRequest> | null);
    });
  }

  /** Read a single request entry */
  async getRequest(key: string): Promise<QueuedRequest | null> {
    return (await this._getValue(`request_queue/${key}`)) as QueuedRequest | null;
  }

  /** Update the status field of a request */
  async updateRequestStatus(key: string, status: QueuedRequest["status"]): Promise<void> {
    const current = await this.getRequest(key);
    if (current) {
      await this._setValue(`request_queue/${key}`, { ...current, status });
    }
  }

  /** Remove a request from the queue (after success) */
  async removeRequest(key: string): Promise<void> {
    await this._remove(`request_queue/${key}`);
  }

  /**
   * Push a new request to the request_queue.
   */
  async pushRequest(request: { type: string; payload: Record<string, unknown> }): Promise<void> {
    const queueRef = ref(this.db, "request_queue");
    await push(queueRef, {
      ...request,
      status: "pending",
      createdAt: nowISO(),
    });
  }

  /** Move a failed request to failed_requests/ with error info */
  async moveRequestToFailed(key: string, error: string): Promise<void> {
    const original = await this.getRequest(key);
    await this._setValue(`failed_requests/${key}`, {
      ...original,
      status: "failed",
      error,
      failedAt: nowISO(),
    });
    await this._remove(`request_queue/${key}`);
  }
}

export interface QueuedRequest {
  type: string;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  /** Injected by orchestrator before dispatch — the Firebase key for this request */
  _key?: string;
}

