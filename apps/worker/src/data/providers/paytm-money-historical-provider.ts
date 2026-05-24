import fetch from "node-fetch";
import moment from "moment";
import { HistoricalDataProvider } from "./historical-data-provider.ts";
import { OHLCV, HistoricalDataRequest } from "../../types/market-data/ohlcv.ts";
import createLogger from "../../utils/logger.ts";

const logger = createLogger("paytm-historical");

/**
 * Historical data provider using Paytm Money's charts API.
 * Fetches 1-minute or daily OHLCV candle data for Indian equities.
 *
 * Uses authenticated headers with SSO token, device ID, and user ID from env.
 */
export default class PaytmMoneyHistoricalProvider implements HistoricalDataProvider {
  readonly name = "paytm-money";

  private readonly baseUrl = "https://api-eq.paytmmoney.com/charts/price/v1/price-charts";

  private getHeaders(): Record<string, string> {
    const ssoToken = process.env.PAYTM_MONEY_SSO_TOKEN || "";
    const userId = process.env.PAYTM_MONEY_USER_ID || "";
    const deviceId = process.env.PAYTM_MONEY_DEVICE_ID || "";

    return {
      "accept": "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "content-type": "application/json",
      "pragma": "no-cache",
      "x-pmngx-key": "paytmmoney",
      "x-sso-token": ssoToken,
      "x-user-agent": JSON.stringify({ platform: "web", user_id: userId, device_id: deviceId }),
      "cookie": `dev-id=${deviceId}; x-sso-token=${ssoToken}; x-user-agent=${encodeURIComponent(JSON.stringify({ platform: "web", user_id: userId, device_id: deviceId }))}`,
    };
  }

  async fetchOHLCV(request: HistoricalDataRequest): Promise<OHLCV[]> {
    const { securityId, fromDate, toDate, interval } = request;

    logger.info(`Fetching ${request.symbol} ${interval} data: ${fromDate} → ${toDate} (pmlId: ${securityId})`);

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        // Note: Paytm API has fromDate/toDate swapped in their payload
        fromDate: toDate,
        toDate: fromDate,
        interval,
        pmlId: securityId,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.error(`API error ${response.status}: ${text.slice(0, 200)}`);
      throw new Error(`Paytm Money API error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as { data: unknown[][]; pc?: number };

    if (!json.data || !Array.isArray(json.data)) {
      logger.error("No data array in response");
      return [];
    }

    logger.info(`Received ${json.data.length} candles`);

    return json.data
      .map((item) => this.parseCandle(item))
      .filter((candle) => {
        const candleDate = this.extractDate(candle.timestamp);
        return candleDate >= fromDate && candleDate <= toDate;
      })
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          fromDate: moment().format("YYYY-MM-DD"),
          toDate: moment().format("YYYY-MM-DD"),
          interval: "MINUTE",
          pmlId: "2885",
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
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

  /**
   * Normalizes Paytm Money timestamp format (DD-MM-YYYY HH:mm)
   * to ISO-like format (YYYY-MM-DD HH:mm).
   */
  private normalizeTimestamp(raw: string): string {
    const parsed = moment(raw, "DD-MM-YYYY HH:mm");
    return parsed.format("YYYY-MM-DD HH:mm");
  }

  /**
   * Extracts YYYY-MM-DD from a normalized timestamp.
   */
  private extractDate(timestamp: string): string {
    return timestamp.split(" ")[0];
  }
}
