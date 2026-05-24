import fetch from "node-fetch";
import { parseDate } from "../../utils/time.ts";
import { TokenExchangeResponse } from "../../types/auth/token-exchange-response.ts";
import { OHLCV } from "../../types/market-data/ohlcv.ts";
import { LtpResponse } from "../../types/market-data/ltp-response.ts";
import createLogger from "../../utils/logger.ts";

const logger = createLogger("paytm-client");

/**
 * Paytm Money API client — handles all HTTP interactions with Paytm Money.
 *
 * Capabilities:
 * - Token exchange (OAuth request_token → access_token)
 * - Live LTP (Last Traded Price) fetching
 * - Historical OHLCV candle data (1-min or daily)
 */
export default class PaytmMoneyClient {
  private readonly chartsUrl = "https://api-eq.paytmmoney.com/charts/price/v1/price-charts";

  // ─── Authentication ──────────────────────────────────────────────────

  async exchangeRequestToken(apiKey: string, apiSecret: string, requestToken: string): Promise<TokenExchangeResponse> {
    const response = await fetch("https://developer.paytmmoney.com/accounts/v2/gettoken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        api_secret_key: apiSecret,
        request_token: requestToken,
      }),
    });
    return response.json() as Promise<TokenExchangeResponse>;
  }

  // ─── Live Data ───────────────────────────────────────────────────────

  async fetchLTP(exchange: string, scripId: string, scripType: string, accessToken: string): Promise<LtpResponse> {
    const pref = `${exchange}:${scripId}:${scripType}`;
    const url = `https://developer.paytmmoney.com/data/v1/price/live?mode=LTP&pref=${pref}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "x-jwt-token": accessToken },
    });
    return response.json() as Promise<LtpResponse>;
  }

  // ─── Historical OHLCV Data ───────────────────────────────────────────

  /**
   * Fetch historical OHLCV candle data for a stock.
   *
   * @param pmlId Paytm Money pmlId for the stock
   * @param fromDate Start date (YYYY-MM-DD)
   * @param toDate End date (YYYY-MM-DD)
   * @param interval "MINUTE" for 1-min candles or "DAY" for daily
   * @returns Array of OHLCV candles sorted chronologically
   */
  async fetchOHLCV(pmlId: string, fromDate: string, toDate: string, interval: "MINUTE" | "DAY" = "MINUTE"): Promise<OHLCV[]> {
    logger.info(`Fetching OHLCV: pmlId=${pmlId}, ${fromDate} → ${toDate}, interval=${interval}`);

    const response = await fetch(this.chartsUrl, {
      method: "POST",
      headers: this.getChartHeaders(),
      body: JSON.stringify({
        // Note: Paytm API has fromDate/toDate swapped in their payload
        fromDate: toDate,
        toDate: fromDate,
        interval,
        pmlId,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error(`API error ${response.status}: ${text.slice(0, 200)}`);
      throw new Error(`Paytm Money API error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as { data: unknown[][] };

    if (!json.data || !Array.isArray(json.data)) {
      logger.error("No data array in response");
      return [];
    }

    logger.info(`Received ${json.data.length} candles`);

    return json.data
      .map((item) => this.parseCandle(item))
      .filter((candle) => {
        const candleDate = candle.timestamp.split(" ")[0];
        return candleDate >= fromDate && candleDate <= toDate;
      })
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // ─── Private Helpers ─────────────────────────────────────────────────

  private getChartHeaders(): Record<string, string> {
    const ssoToken = process.env.PAYTM_MONEY_SSO_TOKEN || "";
    const userId = process.env.PAYTM_MONEY_USER_ID || "";
    const deviceId = process.env.PAYTM_MONEY_DEVICE_ID || "";

    return {
      "accept": "application/json, text/plain, */*",
      "content-type": "application/json",
      "x-pmngx-key": "paytmmoney",
      "x-sso-token": ssoToken,
      "x-user-agent": JSON.stringify({ platform: "web", user_id: userId, device_id: deviceId }),
      "cookie": `dev-id=${deviceId}; x-sso-token=${ssoToken}`,
    };
  }

  private parseCandle(item: unknown[]): OHLCV {
    // Paytm Money returns: [timestamp, open, high, low, close, volume]
    const rawTimestamp = item[0] as string;
    return {
      timestamp: this.normalizeTimestamp(rawTimestamp),
      open: item[1] as number,
      high: item[2] as number,
      low: item[3] as number,
      close: item[4] as number,
      volume: item[5] as number,
    };
  }

  // ─── Stock Search ──────────────────────────────────────────────────

  /**
   * Search for a stock by symbol using Paytm Money suggest API.
   * Returns the exact NSE equity match or null if not found.
   */
  async searchStock(query: string): Promise<StockSearchResult | null> {
    const url = `https://api-eq.paytmmoney.com/data/v2/suggest?is-advanced-user=false&search-scope=ALL&q=${encodeURIComponent(query)}`;

    const ssoToken = process.env.PAYTM_MONEY_SSO_TOKEN;
    const twoFaToken = process.env.PAYTM_MONEY_2FA_TOKEN;
    const userId = process.env.PAYTM_MONEY_USER_ID;
    const deviceId = process.env.PAYTM_MONEY_DEVICE_ID;

    if (!ssoToken || !twoFaToken) {
      throw new Error("Missing PAYTM_MONEY_SSO_TOKEN or PAYTM_MONEY_2FA_TOKEN in .env");
    }

    const response = await fetch(url, {
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "origin": "https://www.paytmmoney.com",
        "referer": "https://www.paytmmoney.com/",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        "x-pmngx-key": "paytmmoney",
        "x-pmmodule-name": "paytmmoney",
        "x-sso-token": ssoToken,
        "x-2fa-token": twoFaToken,
        "x-user-agent": JSON.stringify({
          platform: "web",
          user_id: userId || "",
          device_id: deviceId || "",
        }),
      },
    });

    if (!response.ok) {
      throw new Error(`Paytm search API returned ${response.status}: ${response.statusText}`);
    }

    const json = (await response.json()) as { data?: { results?: StockSearchResult[] } };
    const results = json.data?.results || [];

    if (results.length === 0) return null;

    // Strict: only NSE equity with exact symbol match
    return results.find(
      (r) =>
        r.symbol.toUpperCase() === query.toUpperCase() &&
        r.exchange === "NSE" &&
        r.instrument_type === "ES",
    ) || null;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────

  /**
   * Normalizes Paytm timestamp (DD-MM-YYYY HH:mm) → (YYYY-MM-DD HH:mm)
   */
  private normalizeTimestamp(raw: string): string {
    return parseDate(raw, "DD-MM-YYYY HH:mm").format("YYYY-MM-DD HH:mm");
  }
}

export interface StockSearchResult {
  id: string;
  name: string;
  isin: string;
  mcap: number;
  industry_code: string;
  industry_name: string;
  exchange: string;
  segment: string;
  security_id: number;
  symbol: string;
  series: string;
  instrument_type: string;
  tick_size: number;
  lot_size: number;
  freeze_quantity: number;
}
