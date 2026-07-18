import { Moment } from "moment";
import PaytmMoneyClient from "./providers/paytm-money-client.ts";
import { now } from "../utils/time.ts";
import { StockConfig } from "../types/stocks/stock-config.ts";
import createLogger from "../utils/logger.ts";

const log = createLogger("price-tracker");

const LOOKBACK_DAYS = 10;
const MARKET_OPEN = "09:15";
const MARKET_CLOSE = "15:30";

export interface PriceSnapshot {
  pmlId: string | null;
  releasePrice: number | null;
  releasePriceDate: string | null;
  latestPrice: number | null;
  latestPriceDate: string | null;
  priceChangePct: number | null;
}

const EMPTY_SNAPSHOT: PriceSnapshot = {
  pmlId: null,
  releasePrice: null,
  releasePriceDate: null,
  latestPrice: null,
  latestPriceDate: null,
  priceChangePct: null,
};

/**
 * Tracks a stock's price from the moment its quarterly results were released through to the most
 * recent close, via Paytm Money OHLCV (the same source already used for the rest of this app's
 * price data, unlike NSE's own bhavcopy archive which would be a second, inconsistent source).
 * Degrades to null fields on any failure -- a missing price snapshot shouldn't block the rest of
 * a result record from being saved.
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
      if (!pmlId) {
        log.error(`No pmlId resolved for ${symbol} — skipping price snapshot`);
        return EMPTY_SNAPSHOT;
      }

      const release = await this.resolveReleasePrice(pmlId, announcedAt);
      if (!release) {
        log.error(`No release price found for ${symbol} (announced ${announcedAt.format()}) — no candles on or before that date`);
        return EMPTY_SNAPSHOT;
      }

      const latest = await this.resolveLatestClose(pmlId);
      if (!latest) {
        log.error(`No latest close found for ${symbol} despite a release price — skipping price snapshot`);
        return EMPTY_SNAPSHOT;
      }

      const priceChangePct = release.price !== 0 ? Math.round(((latest.price - release.price) / release.price) * 10000) / 100 : null;

      log.info(`${symbol}: release ₹${release.price} (${release.date}) → latest ₹${latest.price} (${latest.date}), ${priceChangePct}%`);

      return {
        pmlId,
        releasePrice: release.price,
        releasePriceDate: release.date,
        latestPrice: latest.price,
        latestPriceDate: latest.date,
        priceChangePct,
      };
    } catch (err) {
      log.error(`fetchSnapshot failed for ${symbol}`, err);
      return EMPTY_SNAPSHOT;
    }
  }

  /** Just the latest close + date (plus the resolved pmlId, for backfilling records saved before that field existed), for refreshing latestPrice on records whose releasePrice is already set and permanent. */
  async fetchLatestOnly(symbol: string): Promise<{ pmlId: string; latestPrice: number; latestPriceDate: string } | null> {
    try {
      const pmlId = await this.resolvePmlId(symbol);
      if (!pmlId) {
        log.error(`No pmlId resolved for ${symbol} — skipping latest-price refresh`);
        return null;
      }

      const latest = await this.resolveLatestClose(pmlId);
      if (!latest) {
        log.error(`No latest close found for ${symbol} — skipping latest-price refresh`);
        return null;
      }
      return { pmlId, latestPrice: latest.price, latestPriceDate: latest.date };
    } catch (err) {
      log.error(`fetchLatestOnly failed for ${symbol}`, err);
      return null;
    }
  }

  /**
   * The exact price at the moment results were released. When the announcement (per BSE's
   * DT_TM, which is where `announcedAt` comes from -- see bse-client.ts) falls within market
   * hours on a weekday, this looks up the minute candle at or immediately before that exact
   * timestamp. Otherwise -- outside 09:15-15:30, a weekend, or a weekday that turns out to be a
   * holiday with no minute data -- it falls back to the daily close on/before the announcement's
   * trading day, which naturally resolves to the same day's close for an after-hours release, or
   * the prior trading day's close for a pre-market/holiday/weekend one.
   */
  private async resolveReleasePrice(pmlId: string, announcedAt: Moment): Promise<{ price: number; date: string } | null> {
    if (this.isWithinMarketHours(announcedAt)) {
      const day = announcedAt.format("YYYY-MM-DD");
      const minuteCandles = await this.paytm.fetchOHLCV(pmlId, day, day, "MINUTE");
      const cutoff = announcedAt.format("YYYY-MM-DD HH:mm");
      const onOrBefore = minuteCandles.filter((c) => c.timestamp <= cutoff);
      if (onOrBefore.length > 0) {
        const candle = onOrBefore[onOrBefore.length - 1];
        log.info(`pmlId=${pmlId}: minute-level release price ₹${candle.close} at ${candle.timestamp} (announced ${cutoff})`);
        return { price: candle.close, date: candle.timestamp.split(" ")[0] };
      }
      log.info(`pmlId=${pmlId}: announced within market hours (${cutoff}) but no minute candles for ${day} — falling back to daily close`);
    }

    const fromDate = announcedAt.clone().subtract(LOOKBACK_DAYS, "days").format("YYYY-MM-DD");
    const toDate = now().format("YYYY-MM-DD");
    const dailyCandles = await this.paytm.fetchOHLCV(pmlId, fromDate, toDate, "DAY");
    if (dailyCandles.length === 0) {
      log.error(`pmlId=${pmlId}: no daily candles in [${fromDate}, ${toDate}] — cannot resolve a release price`);
      return null;
    }

    const announceDay = announcedAt.format("YYYY-MM-DD");
    const onOrBefore = dailyCandles.filter((c) => c.timestamp.split(" ")[0] <= announceDay);
    const releaseCandle = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : dailyCandles[0];
    log.info(`pmlId=${pmlId}: daily-close release price ₹${releaseCandle.close} on ${releaseCandle.timestamp.split(" ")[0]} (announced ${announceDay})`);
    return { price: releaseCandle.close, date: releaseCandle.timestamp.split(" ")[0] };
  }

  private async resolveLatestClose(pmlId: string): Promise<{ price: number; date: string } | null> {
    const fromDate = now().subtract(LOOKBACK_DAYS, "days").format("YYYY-MM-DD");
    const toDate = now().format("YYYY-MM-DD");
    const candles = await this.paytm.fetchOHLCV(pmlId, fromDate, toDate, "DAY");
    if (candles.length === 0) {
      log.error(`pmlId=${pmlId}: no daily candles in [${fromDate}, ${toDate}] — cannot resolve a latest close`);
      return null;
    }

    const latestCandle = candles[candles.length - 1];
    return { price: latestCandle.close, date: latestCandle.timestamp.split(" ")[0] };
  }

  private isWithinMarketHours(m: Moment): boolean {
    if (m.day() === 0 || m.day() === 6) return false;
    const time = m.format("HH:mm");
    return time >= MARKET_OPEN && time <= MARKET_CLOSE;
  }

  private async resolvePmlId(symbol: string): Promise<string | null> {
    if (this.knownPmlIds[symbol]) return this.knownPmlIds[symbol];
    try {
      const result = await this.paytm.searchStock(symbol);
      if (!result?.id) log.error(`Paytm search returned no match for ${symbol}`);
      return result?.id ?? null;
    } catch (err) {
      log.error(`Paytm search failed for ${symbol}`, err);
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
