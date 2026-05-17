import { initializeApp } from "firebase/app";
import { get, getDatabase, onValue, push, ref, remove } from "firebase/database";
import fetch from "node-fetch";

export class DataFetcher {
  constructor() {
    this.app = initializeApp({
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    this.db = getDatabase(this.app);
  }

  async getAccessToken() {
    const snapshot = await get(ref(this.db, "auth/accessToken"));
    const data = snapshot.val();

    if (!data || !data.token) {
      console.error("No accessToken found in Firebase. Login via the front-end first.");
      process.exit(1);
    }

    return data.token;
  }

  /**
   * Listen for config/enabled changes in Firebase.
   * Calls onEnabled(true/false) whenever the value changes.
   */
  onEnabledChange(callback) {
    onValue(ref(this.db, "config/enabled"), (snapshot) => {
      const enabled = snapshot.val();
      callback(enabled);
    });
  }

  /**
   * Fetch LTP data for a given scrip using the Live Market Data API.
   *
   * GET https://developer.paytmmoney.com/data/v1/price/live
   * Header: x-jwt-token
   * Query: mode=LTP&pref={Exchange}:{ScripId}:{ScripType}
   *
   * @param {string} exchange - e.g. "NSE" or "BSE"
   * @param {string} scripId - e.g. "13" for NIFTY or security id
   * @param {string} scripType - e.g. "INDEX", "EQUITY", "ETF", "FUTURE", "OPTION"
   */
  /**
   * Push a price tick to Firebase under prices/{date}.
   * Stored as { time, price } object in a list.
   *
   * @param {string} time - HH:mm format
   * @param {number} price - last traded price
   */
  async storeTick(date, data) {
    await push(ref(this.db, `prices`), data );
  }

  async storeSignal(date, data) {
    await push(ref(this.db, `signals`), data );
  }

  async clearTicks() {
    await remove(ref(this.db, "prices"));
  }

  async clearSignals() {
    await remove(ref(this.db, "signals"));
  }

  async fetchLTP(exchange, scripId, scripType, accessToken) {
    const pref = `${exchange}:${scripId}:${scripType}`;
    const url = `https://developer.paytmmoney.com/data/v1/price/live?mode=LTP&pref=${pref}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-jwt-token": accessToken,
      },
    });
    return await response.json();
  }
}
