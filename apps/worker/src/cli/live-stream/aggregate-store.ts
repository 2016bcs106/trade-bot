import { resolve } from "path";
import { mkdirSync, readdirSync, unlinkSync, readFileSync, existsSync, writeFileSync } from "fs";
import moment from "moment";
import { StockConfig } from "../../types/stocks/stock-config.ts";
import { nowISO } from "../../utils/time.ts";
import { MinuteAggregatePayload, PriceInfo, Signal } from "./types.ts";
import { Logger } from "../../types/logger.ts";
import { RsiState, createRsiState, computeFullRsi, computeIncrementalRsi } from "./compute-rsi.ts";
import { SignalState, createSignalState, computeFullSignals, computeIncrementalSignal } from "./compute-signals.ts";

export default class AggregateStore {
  private minuteAggregatesByInstrument = new Map<string, Map<string, MinuteAggregatePayload>>();
  private latestPriceByInstrument = new Map<string, PriceInfo>();
  private rsiStateByInstrument = new Map<string, RsiState>();
  private signalStateByInstrument = new Map<string, SignalState>();
  private lastMinuteKeyByInstrument = new Map<string, string>();
  private aggregatesDir: string;

  constructor(
    private log: Logger,
    dataDir: string,
    private getInstrumentKey: (stock: StockConfig) => string,
    private getScripId: (stock: StockConfig) => number,
  ) {
    this.aggregatesDir = resolve(dataDir, "aggregates");
    mkdirSync(this.aggregatesDir, { recursive: true });
  }

  upsertFromTick(tick: Record<string, unknown>, stock: StockConfig): MinuteAggregatePayload | null {
    const price = Number(tick.last_price);
    if (!Number.isFinite(price)) return null;

    const instrumentKey = this.getInstrumentKey(stock);
    const receivedAt = String(tick.received_at ?? nowISO());
    const minuteKey = moment(receivedAt).utcOffset("+05:30").format("YYYY-MM-DDTHH:mm");
    const dateIst = minuteKey.slice(0, 10);

    const buyQtyRaw = Number(tick.total_buy_quantity);
    const sellQtyRaw = Number(tick.total_sell_quantity);
    const buyQty = Number.isFinite(buyQtyRaw) ? buyQtyRaw : 0;
    const sellQty = Number.isFinite(sellQtyRaw) ? sellQtyRaw : 0;

    let perInstrument = this.minuteAggregatesByInstrument.get(instrumentKey);
    if (!perInstrument) {
      perInstrument = new Map<string, MinuteAggregatePayload>();
      this.minuteAggregatesByInstrument.set(instrumentKey, perInstrument);
    }

    const existing = perInstrument.get(minuteKey);
    const lastMinuteKey = this.lastMinuteKeyByInstrument.get(instrumentKey);

    if (!existing) {
      // New minute: advance the RSI state with the previous minute's final values
      if (lastMinuteKey) {
        const prevMinute = perInstrument.get(lastMinuteKey);
        if (prevMinute) {
          let state = this.rsiStateByInstrument.get(instrumentKey);
          if (!state) { state = createRsiState(); this.rsiStateByInstrument.set(instrumentKey, state); }
          const rsiVal = computeIncrementalRsi(state, prevMinute.buyQtySum, prevMinute.sellQtySum);
          prevMinute.rsi = rsiVal != null ? Number(rsiVal.toFixed(2)) : null;
          // Finalize signal for previous minute
          const signalState = this.getOrCreateSignalState(instrumentKey);
          const { sma, upper, lower } = this.computeBollingerAt(instrumentKey, lastMinuteKey);
          prevMinute.signal = computeIncrementalSignal(signalState, prevMinute, sma, upper, lower);
        }
      }
      this.lastMinuteKeyByInstrument.set(instrumentKey, minuteKey);

      const first: MinuteAggregatePayload = {
        instrumentKey,
        symbol: stock.symbol,
        displayName: stock.name,
        exchangeType: stock.exchange,
        scripType: "EQUITY",
        scripId: this.getScripId(stock),
        minute: minuteKey,
        dateIst,
        open: price,
        high: price,
        low: price,
        close: price,
        tickCount: 1,
        buyQtySum: buyQty,
        sellQtySum: sellQty,
        buySellRatio: sellQty > 0 ? Number((buyQty / sellQty).toFixed(6)) : null,
        rsi: null,
        signal: null,
        lastUpdatedAt: receivedAt,
      };
      first.rsi = this.computeTentativeRsi(instrumentKey, buyQty, sellQty);
      first.signal = this.computeTentativeSignal(instrumentKey, first);
      perInstrument.set(minuteKey, first);
      this.updatePriceCache(instrumentKey);
      return first;
    }

    existing.high = Math.max(existing.high, price);
    existing.low = Math.min(existing.low, price);
    existing.close = price;
    existing.tickCount += 1;
    existing.buyQtySum += buyQty;
    existing.sellQtySum += sellQty;
    existing.buySellRatio = existing.sellQtySum > 0 ? Number((existing.buyQtySum / existing.sellQtySum).toFixed(6)) : null;
    existing.rsi = this.computeTentativeRsi(instrumentKey, existing.buyQtySum, existing.sellQtySum);
    existing.signal = this.computeTentativeSignal(instrumentKey, existing);
    existing.lastUpdatedAt = receivedAt;
    this.updatePriceCache(instrumentKey);
    return existing;
  }

  private updatePriceCache(instrumentKey: string): void {
    const allMinutes = this.minuteAggregatesByInstrument.get(instrumentKey);
    if (!allMinutes) return;
    const sorted = Array.from(allMinutes.values()).sort((a, b) => a.minute.localeCompare(b.minute));
    const price = sorted[sorted.length - 1].close;
    let open: number | null = null;
    for (const r of sorted) {
      const time = r.minute.split("T")[1]?.slice(0, 5) || "";
      if (time >= "09:00") { open = r.close; break; }
    }
    if (open == null) open = sorted[0].close;
    const change = price - open;
    const changePct = open !== 0 ? (change / open) * 100 : 0;
    this.latestPriceByInstrument.set(instrumentKey, { price, change, changePct });
  }

  private computeTentativeRsi(instrumentKey: string, buyQtySum: number, sellQtySum: number): number | null {
    const state = this.rsiStateByInstrument.get(instrumentKey);
    if (!state || !state.seeded) return null;
    const sell = sellQtySum || 0;
    const ratio = sell > 0 ? buyQtySum / sell : 1;
    const change = ratio - state.prevRatio;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    const avgGain = (state.avgGain * 13 + gain) / 14;
    const avgLoss = (state.avgLoss * 13 + loss) / 14;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    return Number(rsi.toFixed(2));
  }

  private getOrCreateSignalState(instrumentKey: string): SignalState {
    let state = this.signalStateByInstrument.get(instrumentKey);
    if (!state) { state = createSignalState(); this.signalStateByInstrument.set(instrumentKey, state); }
    return state;
  }

  private computeBollingerAt(instrumentKey: string, targetMinuteKey: string): { sma: number | null; upper: number | null; lower: number | null } {
    const minuteMap = this.minuteAggregatesByInstrument.get(instrumentKey);
    if (!minuteMap) return { sma: null, upper: null, lower: null };
    const sorted = Array.from(minuteMap.values()).sort((a, b) => a.minute.localeCompare(b.minute));
    const targetIdx = sorted.findIndex((a) => a.minute === targetMinuteKey);
    if (targetIdx < 0) return { sma: null, upper: null, lower: null };

    const BB_PERIOD = 20;
    const start = Math.max(0, targetIdx - BB_PERIOD + 1);
    const window = sorted.slice(start, targetIdx + 1).map((a) => a.close);
    if (window.length < BB_PERIOD) return { sma: null, upper: null, lower: null };

    const mean = window.reduce((a, b) => a + b, 0) / BB_PERIOD;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / BB_PERIOD;
    const std = Math.sqrt(variance);
    return { sma: mean, upper: mean + 2 * std, lower: mean - 2 * std };
  }

  private computeTentativeSignal(instrumentKey: string, agg: MinuteAggregatePayload): Signal {
    const signalState = this.signalStateByInstrument.get(instrumentKey);
    if (!signalState) return null;
    const { sma, upper, lower } = this.computeBollingerAt(instrumentKey, agg.minute);
    // Use a copy of state so tentative computation doesn't mutate actual state
    const tempState: SignalState = { ...signalState };
    const signal = computeIncrementalSignal(tempState, agg, sma, upper, lower);
    return signal;
  }

  getPrice(instrumentKey: string): PriceInfo | undefined {
    return this.latestPriceByInstrument.get(instrumentKey);
  }



  getSnapshotData(instrumentKey: string): MinuteAggregatePayload[] {
    const map = this.minuteAggregatesByInstrument.get(instrumentKey);
    if (!map) return [];
    return Array.from(map.values()).sort((a, b) => a.minute.localeCompare(b.minute));
  }

  has(instrumentKey: string): boolean {
    return this.minuteAggregatesByInstrument.has(instrumentKey);
  }

  clear(): void {
    this.minuteAggregatesByInstrument.clear();
    this.latestPriceByInstrument.clear();
    this.rsiStateByInstrument.clear();
    this.signalStateByInstrument.clear();
    this.lastMinuteKeyByInstrument.clear();
  }

  get size(): number {
    return this.minuteAggregatesByInstrument.size;
  }

  save(instrumentByKey: Map<string, StockConfig>): void {
    if (this.minuteAggregatesByInstrument.size === 0) return;

    let saved = 0;
    for (const [instrumentKey, minuteMap] of this.minuteAggregatesByInstrument.entries()) {
      if (minuteMap.size === 0) continue;
      const stock = instrumentByKey.get(instrumentKey);
      if (!stock) continue;

      const data = Array.from(minuteMap.values()).sort((a, b) => a.minute.localeCompare(b.minute));
      const date = data[0].dateIst;
      const filePath = resolve(this.aggregatesDir, `${stock.exchange}_${this.getScripId(stock)}_${date}.json`);
      writeFileSync(filePath, JSON.stringify(data));
      saved++;
    }

    this.log.info(`Saved aggregates for ${saved} instruments`);
  }

  loadForStock(stock: StockConfig, date: string): boolean {
    const scripId = this.getScripId(stock);
    const filePath = resolve(this.aggregatesDir, `${stock.exchange}_${scripId}_${date}.json`);
    if (!existsSync(filePath)) return false;

    try {
      const content = readFileSync(filePath, "utf-8");
      const data = JSON.parse(content) as MinuteAggregatePayload[];
      if (!Array.isArray(data) || data.length === 0) return false;

      const instrumentKey = this.getInstrumentKey(stock);
      const minuteMap = new Map<string, MinuteAggregatePayload>();
      for (const entry of data) {
        minuteMap.set(entry.minute, entry);
      }
      this.minuteAggregatesByInstrument.set(instrumentKey, minuteMap);
      this.updatePriceCache(instrumentKey);
      this.recomputeRsi(instrumentKey);

      this.log.info(`Loaded ${data.length} minutes for ${stock.symbol} from ${date}`);
      return true;
    } catch {
      return false;
    }
  }

  private recomputeRsi(instrumentKey: string): void {
    const minuteMap = this.minuteAggregatesByInstrument.get(instrumentKey);
    if (!minuteMap) return;
    const sorted = Array.from(minuteMap.values()).sort((a, b) => a.minute.localeCompare(b.minute));
    const { rsiValues, state } = computeFullRsi(sorted);
    for (let i = 0; i < sorted.length; i++) {
      sorted[i].rsi = rsiValues[i] != null ? Number(rsiValues[i]!.toFixed(2)) : null;
    }
    this.rsiStateByInstrument.set(instrumentKey, state);
    if (sorted.length > 0) {
      this.lastMinuteKeyByInstrument.set(instrumentKey, sorted[sorted.length - 1].minute);
    }
    const signalState = computeFullSignals(sorted);
    this.signalStateByInstrument.set(instrumentKey, signalState);
  }

  loadHistorical(stocks: { stock: any; instrumentKey: string }[], marketStatus: string, dateIST: string, targetDate: string | null): number {
    let totalLoaded = 0;

    if (marketStatus !== "Closed") {
      for (const { stock, instrumentKey } of stocks) {
        if (this.has(instrumentKey)) continue;
        if (this.loadForStock(stock, dateIST)) totalLoaded++;
      }
    } else {
      for (const { stock, instrumentKey } of stocks) {
        if (this.has(instrumentKey)) continue;
        let loaded = false;

        if (targetDate) {
          loaded = this.loadForStock(stock, targetDate);
        }
        if (!loaded) {
          for (let daysBack = 0; daysBack < 7; daysBack++) {
            const date = moment().utcOffset("+05:30").subtract(daysBack, "days").format("YYYY-MM-DD");
            if (this.loadForStock(stock, date)) { loaded = true; break; }
          }
        }
        if (loaded) totalLoaded++;
      }
    }

    if (totalLoaded > 0) this.log.info(`Historical data loaded for ${totalLoaded} stocks`);
    return totalLoaded;
  }

  cleanupOldFiles(): void {
    const keepDates = new Set<string>();
    for (let i = 0; i < 7; i++) {
      keepDates.add(moment().utcOffset("+05:30").subtract(i, "days").format("YYYY-MM-DD"));
    }

    for (const fileName of readdirSync(this.aggregatesDir)) {
      if (!fileName.endsWith(".json")) continue;
      const match = fileName.match(/_(\d{4}-\d{2}-\d{2})\.json$/);
      if (!match) continue;
      if (keepDates.has(match[1])) continue;
      try {
        unlinkSync(resolve(this.aggregatesDir, fileName));
        this.log.info(`Cleaned up old aggregate file: ${fileName}`);
      } catch {}
    }
  }
}
