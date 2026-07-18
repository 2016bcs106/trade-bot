import { Moment } from "moment";
import PaytmMoneyClient from "./providers/paytm-money-client.ts";
import { now } from "../utils/time.ts";
import { StockConfig } from "../types/stocks/stock-config.ts";

const LOOKBACK_DAYS = 10;

export interface PriceSnapshot {
  releasePrice: number | null;
  releasePriceDate: string | null;
  latestPrice: number | null;
  latestPriceDate: string | null;
  priceChangePct: number | null;
}

const EMPTY_SNAPSHOT: PriceSnapshot = {
  releasePrice: null,
  releasePriceDate: null,
  latestPrice: null,
  latestPriceDate: null,
  priceChangePct: null,
};

/**
 * Tracks a stock's price from the day its quarterly results were released through to the most
 * recent close, via Paytm Money's daily OHLCV (the same source already used for the rest of this
 * app's price data, unlike NSE's own bhavcopy archive which would be a second, inconsistent
 * source). Degrades to null fields on any failure -- a missing price snapshot shouldn't block
 * the rest of a result record from being saved.
 */
export default class PriceTracker {
  constructor(
    private paytm: PaytmMoneyClient,
    /** Symbol -> pmlId for stocks already tracked in Firebase, checked before falling back to a live search. */
    private knownPmlIds: Record<string, string>
  ) {}

  async fetchSnapshot(symbol: string, announcedAt: Moment): Promise<PriceSnapshot> {
    try {
      const pmlId = await this.resolvePmlId(symbol);
      if (!pmlId) return EMPTY_SNAPSHOT;

      const fromDate = announcedAt.clone().subtract(LOOKBACK_DAYS, "days").format("YYYY-MM-DD");
      const toDate = now().format("YYYY-MM-DD");
      const candles = await this.paytm.fetchOHLCV(pmlId, fromDate, toDate, "DAY");
      if (candles.length === 0) return EMPTY_SNAPSHOT;

      // "Release price" is the close on the announcement's trading day, or -- if results were
      // announced outside market hours, on a holiday, or on a weekend -- the last available
      // close before it. Filtering to candles on/before the announcement date and taking the
      // last one covers both cases with the same logic.
      const announceDay = announcedAt.format("YYYY-MM-DD");
      const onOrBefore = candles.filter((c) => c.timestamp.split(" ")[0] <= announceDay);
      const releaseCandle = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : candles[0];
      const latestCandle = candles[candles.length - 1];

      const releasePrice = releaseCandle.close;
      const latestPrice = latestCandle.close;
      const priceChangePct = releasePrice !== 0 ? Math.round(((latestPrice - releasePrice) / releasePrice) * 10000) / 100 : null;

      return {
        releasePrice,
        releasePriceDate: releaseCandle.timestamp.split(" ")[0],
        latestPrice,
        latestPriceDate: latestCandle.timestamp.split(" ")[0],
        priceChangePct,
      };
    } catch {
      return EMPTY_SNAPSHOT;
    }
  }

  /** Just the latest close + date, for refreshing latestPrice on records whose releasePrice is already set and permanent. */
  async fetchLatestOnly(symbol: string): Promise<{ latestPrice: number; latestPriceDate: string } | null> {
    try {
      const pmlId = await this.resolvePmlId(symbol);
      if (!pmlId) return null;

      const fromDate = now().subtract(LOOKBACK_DAYS, "days").format("YYYY-MM-DD");
      const toDate = now().format("YYYY-MM-DD");
      const candles = await this.paytm.fetchOHLCV(pmlId, fromDate, toDate, "DAY");
      if (candles.length === 0) return null;

      const latestCandle = candles[candles.length - 1];
      return { latestPrice: latestCandle.close, latestPriceDate: latestCandle.timestamp.split(" ")[0] };
    } catch {
      return null;
    }
  }

  private async resolvePmlId(symbol: string): Promise<string | null> {
    if (this.knownPmlIds[symbol]) return this.knownPmlIds[symbol];
    try {
      const result = await this.paytm.searchStock(symbol);
      return result?.id ?? null;
    } catch {
      return null;
    }
  }
}

export function pmlIdsBySymbol(stocks: Record<string, StockConfig>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const stock of Object.values(stocks)) {
    if (stock.pmlId) map[stock.symbol] = stock.pmlId;
  }
  return map;
}
