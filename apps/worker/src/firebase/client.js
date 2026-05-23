import "../config/env.js";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set, push, remove, onValue } from "firebase/database";

const app = initializeApp({
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = getDatabase(app);

/**
 * Centralized Firebase Realtime Database client.
 * Handles initialization and all read/write operations.
 */
export default class FirebaseClient {
  constructor() {
    this.db = db;
  }

  // ─── Auth Tokens ──────────────────────────────────────────────────

  async getAccessToken() {
    const data = await this._getValue("auth/accessToken");
    if (!data?.token) {
      throw new Error("No accessToken found in Firebase. Login via the front-end first.");
    }
    return data.token;
  }

  onAccessTokenChange(callback) {
    return this._onChange("auth/accessToken", (data) => {
      if (data?.token) callback(data.token);
    });
  }

  onPublicAccessTokenChange(callback) {
    return this._onChange("auth/publicAccessToken", (data) => {
      if (data?.token) callback(data.token);
    });
  }

  onRequestTokenChange(callback) {
    return this._onChange("auth/requestToken", (data) => {
      if (data?.token) callback(data.token);
    });
  }

  async saveAccessTokens({ accessToken, publicAccessToken, readAccessToken, updatedOn }) {
    await Promise.all([
      this._setValue("auth/accessToken", { token: accessToken, timestamp: updatedOn }),
      this._setValue("auth/publicAccessToken", { token: publicAccessToken, timestamp: updatedOn }),
      this._setValue("auth/readAccessToken", { token: readAccessToken, timestamp: updatedOn }),
      this._setValue("auth/updatedOn", updatedOn),
    ]);
  }

  // ─── Config ───────────────────────────────────────────────────────

  onEnabledChange(callback) {
    return this._onChange("config/enabled", callback);
  }

  // ─── Ticks & Signals ──────────────────────────────────────────────

  async storeTick(date, data) {
    await push(ref(this.db, "prices"), data);
  }

  async storeSignal(date, data) {
    await push(ref(this.db, "signals"), data);
  }

  async clearTicks() {
    await this._remove("prices");
  }

  async clearSignals() {
    await this._remove("signals");
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  async _getValue(path) {
    const snapshot = await get(ref(this.db, path));
    return snapshot.val();
  }

  async _setValue(path, value) {
    await set(ref(this.db, path), value);
  }

  async _remove(path) {
    await remove(ref(this.db, path));
  }

  /**
   * Generic Firebase listener that deduplicates by serialized value.
   * Calls callback only when value actually changes.
   */
  _onChange(path, callback) {
    let previous = undefined;
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
