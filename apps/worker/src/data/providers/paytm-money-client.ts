import fetch from "node-fetch";
import moment from "moment";
import { TokenExchangeResponse } from "../../types/auth/token-exchange-response.ts";
import { HistoricalDataPoint } from "../../types/market-data/historical-data-point.ts";
import { LtpResponse } from "../../types/market-data/ltp-response.ts";

/**
 * HTTP client for Paytm Money REST APIs.
 * Handles: LTP fetching, historical data retrieval.
 * Does NOT handle Firebase — that's FirebaseClient's job.
 */
export default class PaytmMoneyClient {
  async fetchLTP(exchange: string, scripId: string, scripType: string, accessToken: string): Promise<LtpResponse> {
    const pref = `${exchange}:${scripId}:${scripType}`;
    const url = `https://developer.paytmmoney.com/data/v1/price/live?mode=LTP&pref=${pref}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { "x-jwt-token": accessToken },
    });
    return response.json() as Promise<LtpResponse>;
  }

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

  async getHistoricalData(fromDate: string, toDate: string, pmlId: string): Promise<HistoricalDataPoint[]> {
    const response = await fetch(
      "https://api-eq.paytmmoney.com/charts/price/v1/price-charts",
      {
        headers: {
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
          "x-pmngx-key": "paytmmoney",
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

    const data = await response.json() as { data: unknown[][] };

    return data.data
      .map((item) => ({
        date: item[0] as string,
        close: item[4] as number,
        volume: item[5] as number,
      }))
      .filter(item => moment(item.date.split(" ")[0], "DD-MM-YYYY").format("YYYY-MM-DD") === toDate);
  }
}
