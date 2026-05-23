import "../config/env.ts";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, push, remove, onValue, Database, Unsubscribe } from "firebase/database";
import { SaveAccessTokensPayload } from "../types/auth/save-access-tokens-payload.ts";
import { TickData } from "../types/market-data/tick-data.ts";
import { SignalData } from "../types/market-data/signal-data.ts";

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
}
