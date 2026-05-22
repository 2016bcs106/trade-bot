import { initializeApp } from "firebase/app";
import { get, getDatabase, onValue, push, ref, remove } from "firebase/database";
import moment from "moment";
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
     * Listen for accessToken changes in Firebase.
     * Calls callback(newToken) whenever the token value changes.
     * Returns the unsubscribe function.
     */
    onAccessTokenChange(callback) {
        let currentToken = null;
        return onValue(ref(this.db, "auth/accessToken"), (snapshot) => {
            const data = snapshot.val();
            if (!data || !data.token) return;
            if (data.token !== currentToken) {
                currentToken = data.token;
                callback(currentToken);
            }
        });
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
        await push(ref(this.db, `prices`), data);
    }

    async storeSignal(date, data) {
        await push(ref(this.db, `signals`), data);
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

    /**
     * Returns test data for dry run / backtesting.
     * Each entry: { date: "YYYY-MM-DD HH:mm", close: number }
     *
     * Replace or extend this data with your own historical prices.
     */
    async getDryRunData(fromDate, toDate, pmlId) {
        const response = await fetch(
            "https://api-eq.paytmmoney.com/charts/price/v1/price-charts",
            {
                headers: {
                    accept: "application/json, text/plain, */*",
                    "accept-language": "en-US,en;q=0.9",
                    "content-type": "application/json",
                    priority: "u=1, i",
                    "sec-ch-ua":
                        '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": '"macOS"',
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-origin",
                    "x-pmngx-key": "paytmmoney",
                    "x-request-id": "45525300-5068-11f1-b795-4bb77e3a4e27",
                    "x-sso-token": "56d3eec0-907a-4cf4-ad4f-803cdcd91900",
                    "x-user-agent":
                        '{"platform":"web","user_id":"69491394","appName":"Netscape","os_version":"5","product":"Chrome","device_id":"48535f45-191d-5e4f-9a0e-9aa155dd42a2"}',
                },
                body: JSON.stringify({
                    toDate: fromDate,
                    fromDate: toDate,
                    interval: "MINUTE",
                    pmlId,
                }),
                method: "POST",
            },
        );

        const data = await response.json();

        return data.data
            .map((item) => ({
                date: item[0],
                close: item[4],
                volume: item[5],
            }))
            .filter(item => moment(item.date.split(" ")[0], "DD-MM-YYYY").format("YYYY-MM-DD") === toDate);
    }
}
