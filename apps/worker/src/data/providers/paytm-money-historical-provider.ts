import fetch from "node-fetch";
import moment from "moment";
import { HistoricalDataProvider } from "./historical-data-provider.ts";
import { OHLCV, HistoricalDataRequest } from "../../types/market-data/ohlcv.ts";

/**
 * Historical data provider using Paytm Money's public charts API.
 * Fetches 1-minute OHLCV candle data for Indian equities.
 *
 * Note: This API does not require authentication (uses x-pmngx-key header).
 * It supports MINUTE interval data which is what we need for intraday features.
 */
export default class PaytmMoneyHistoricalProvider implements HistoricalDataProvider {
  readonly name = "paytm-money";

  private readonly baseUrl = "https://api-eq.paytmmoney.com/charts/price/v1/price-charts";

  async fetchOHLCV(request: HistoricalDataRequest): Promise<OHLCV[]> {
    const { securityId, fromDate, toDate } = request;

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        "x-pmngx-key": "paytmmoney",
      },
      body: JSON.stringify({
        // Note: Paytm API has fromDate/toDate swapped in their payload
        toDate: fromDate,
        fromDate: toDate,
        interval: this.mapInterval(request.interval),
        pmlId: securityId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Paytm Money API error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as { data: unknown[][] };

    if (!json.data || !Array.isArray(json.data)) {
      return [];
    }

    return json.data
      .map((item) => this.parseCandle(item))
      .filter((candle) => {
        // Filter to only the requested date range
        const candleDate = this.extractDate(candle.timestamp);
        return candleDate >= fromDate && candleDate <= toDate;
      })
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Simple connectivity check — fetch with a known pmlId
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
          "x-pmngx-key": "paytmmoney",
        },
        body: JSON.stringify({
          toDate: moment().format("YYYY-MM-DD"),
          fromDate: moment().format("YYYY-MM-DD"),
          interval: "MINUTE",
          pmlId: "2885", // RELIANCE as a test
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

  private mapInterval(interval: string): string {
    switch (interval) {
      case "1min": return "MINUTE";
      case "5min": return "5MINUTE";
      case "15min": return "15MINUTE";
      case "30min": return "30MINUTE";
      case "60min": return "60MINUTE";
      case "daily": return "DAY";
      default: return "MINUTE";
    }
  }
}
