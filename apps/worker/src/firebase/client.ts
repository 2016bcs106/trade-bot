import "../config/env.ts";
import { nowISO } from "../utils/time.ts";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, push, remove, onValue, onChildAdded, Database, Unsubscribe } from "firebase/database";
import { SaveAccessTokensPayload } from "../types/auth/save-access-tokens-payload.ts";
import { TickData } from "../types/market-data/tick-data.ts";
import { SignalData } from "../types/market-data/signal-data.ts";
import { ScriptStatus } from "../types/script-status.ts";
import { StockConfig } from "../types/stocks/index.ts";
import { Prediction, EvaluationResult } from "../types/predictions/index.ts";
import { ModelMetadata } from "../types/models/index.ts";
import { AuditEvent } from "../types/audit/index.ts";

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

  // ─── Script Status ────────────────────────────────────────────────

  async updateScriptStatus(scriptName: string, status: ScriptStatus): Promise<void> {
    await this._setValue(`scripts/${scriptName}`, status);
  }

  // ─── Config ───────────────────────────────────────────────────────

  onEnabledChange(callback: (enabled: boolean | null) => void): Unsubscribe {
    return this._onChange("config/enabled", (value) => {
      callback(value as boolean | null);
    });
  }

  // ─── Ticks & Signals ──────────────────────────────────────────────

  async storeTick(_date: string, data: TickData): Promise<void> {
    await push(ref(this.db, "prices"), data);
  }

  async storeSignal(_date: string, data: SignalData): Promise<void> {
    await push(ref(this.db, "signals"), data);
  }

  async clearTicks(): Promise<void> {
    await this._remove("prices");
  }

  async clearSignals(): Promise<void> {
    await this._remove("signals");
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

  onStocksChange(callback: (stocks: Record<string, StockConfig> | null) => void): Unsubscribe {
    return this._onChange("stocks", (value) => {
      callback(value as Record<string, StockConfig> | null);
    });
  }

  // ─── Predictions ───────────────────────────────────────────────────

  async setPrediction(symbol: string, date: string, prediction: Prediction): Promise<void> {
    await this._setValue(`predictions/${symbol}/${date}`, prediction);
  }

  async getPrediction(symbol: string, date: string): Promise<Prediction | null> {
    const data = await this._getValue(`predictions/${symbol}/${date}`);
    return data as Prediction | null;
  }

  async setEvaluation(symbol: string, date: string, evaluation: EvaluationResult): Promise<void> {
    await this._setValue(`predictions/${symbol}/${date}/evaluation`, evaluation);
  }

  // ─── Models ────────────────────────────────────────────────────────

  async setModelMetadata(symbol: string, version: string, metadata: ModelMetadata): Promise<void> {
    await this._setValue(`models/${symbol}/${version}`, metadata);
  }

  async removeModelMetadata(symbol: string, version: string): Promise<void> {
    await this._setValue(`models/${symbol}/${version}`, null);
  }

  async getModelMetadata(symbol: string, version: string): Promise<ModelMetadata | null> {
    const data = await this._getValue(`models/${symbol}/${version}`);
    return data as ModelMetadata | null;
  }

  async getAllModelVersions(symbol: string): Promise<Record<string, ModelMetadata>> {
    const data = await this._getValue(`models/${symbol}`);
    return (data as Record<string, ModelMetadata>) || {};
  }

  // ─── Audit ─────────────────────────────────────────────────────────

  async pushAuditEvent(event: Omit<AuditEvent, "id">): Promise<string> {
    const auditRef = push(ref(this.db, "audit"));
    const id = auditRef.key!;
    await set(auditRef, { ...event, id });
    return id;
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private async _getValue(path: string): Promise<unknown> {
    const snapshot = await get(ref(this.db, path));
    return snapshot.val();
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

  // ─── Pending Predictions ─────────────────────────────────────────────

  /**
   * Listen for new entries in pending_predictions/.
   * Each entry: { symbol, date, status, createdAt }
   * Calls callback for each newly added child.
   */
  onPendingPredictionAdded(callback: (key: string, entry: PendingPredictionEntry) => void): Unsubscribe {
    return onChildAdded(ref(this.db, "pending_predictions"), (snapshot) => {
      const key = snapshot.key;
      const val = snapshot.val();
      if (key && val) callback(key, val as PendingPredictionEntry);
    });
  }

  async updatePendingPrediction(key: string, update: Partial<PendingPredictionEntry>): Promise<void> {
    const current = await this._getValue(`pending_predictions/${key}`) as PendingPredictionEntry | null;
    if (current) {
      await this._setValue(`pending_predictions/${key}`, { ...current, ...update });
    }
  }

  async removePendingPrediction(key: string): Promise<void> {
    await this._remove(`pending_predictions/${key}`);
  }

  async getAllPendingPredictions(): Promise<Record<string, PendingPredictionEntry>> {
    return (await this._getValue("pending_predictions") as Record<string, PendingPredictionEntry>) || {};
  }

  // ─── Pending Trainings ──────────────────────────────────────────────

  onPendingTrainingAdded(callback: (key: string, entry: PendingTrainingEntry) => void): Unsubscribe {
    return onChildAdded(ref(this.db, "pending_trainings"), (snapshot) => {
      const key = snapshot.key;
      const val = snapshot.val();
      if (key && val) callback(key, val as PendingTrainingEntry);
    });
  }

  async updatePendingTraining(key: string, update: Partial<PendingTrainingEntry>): Promise<void> {
    const current = await this._getValue(`pending_trainings/${key}`) as PendingTrainingEntry | null;
    if (current) {
      await this._setValue(`pending_trainings/${key}`, { ...current, ...update });
    }
  }

  async removePendingTraining(key: string): Promise<void> {
    await this._remove(`pending_trainings/${key}`);
  }

  async getAllPendingTrainings(): Promise<Record<string, PendingTrainingEntry>> {
    return (await this._getValue("pending_trainings") as Record<string, PendingTrainingEntry>) || {};
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

export interface PendingPredictionEntry {
  symbol: string;
  fromDate: string;
  toDate: string;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  processedDates?: number;
  totalDates?: number;
  error?: string;
}

export interface PendingTrainingEntry {
  symbol: string;
  modelType: string; // "auto" | "random-forest" | "linear-regression" | etc.
  lookbackDays: number;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  error?: string;
  resultVersion?: string;
}
