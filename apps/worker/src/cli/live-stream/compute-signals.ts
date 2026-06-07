import { MinuteAggregatePayload, Signal } from "./types.ts";

const MARKET_START = 9 * 60;
const MARKET_END = 15 * 60 + 30;
const TOTAL_MINUTES = MARKET_END - MARKET_START + 1;
const BB_PERIOD = 20;
const MULTIPLIER = 2;

export interface SignalState {
  position: "long" | "short" | null;
  entryPrice: number | null;
  netProfit: number;
}

export function createSignalState(): SignalState {
  return { position: null, entryPrice: null, netProfit: 0 };
}

function minuteKeyToSlot(minuteKey: string): number {
  const time = minuteKey.split("T")[1];
  if (!time) return -1;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m - MARKET_START;
}

function computeBollingerBands(grid: (MinuteAggregatePayload | null)[]) {
  const sma: (number | null)[] = new Array(grid.length).fill(null);
  const upper: (number | null)[] = new Array(grid.length).fill(null);
  const lower: (number | null)[] = new Array(grid.length).fill(null);

  const window: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]) window.push(grid[i]!.close);
    if (window.length > BB_PERIOD) window.shift();
    if (window.length === BB_PERIOD) {
      const mean = window.reduce((a, b) => a + b, 0) / BB_PERIOD;
      const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / BB_PERIOD;
      const std = Math.sqrt(variance);
      sma[i] = mean;
      upper[i] = mean + MULTIPLIER * std;
      lower[i] = mean - MULTIPLIER * std;
    }
  }

  return { sma, upper, lower };
}

export function computeFullSignals(aggregates: MinuteAggregatePayload[]): SignalState {
  const state = createSignalState();

  const grid: (MinuteAggregatePayload | null)[] = new Array(TOTAL_MINUTES).fill(null);
  for (const agg of aggregates) {
    const slot = minuteKeyToSlot(agg.minute);
    if (slot >= 0 && slot < TOTAL_MINUTES) grid[slot] = agg;
  }

  const { sma, upper, lower } = computeBollingerBands(grid);

  for (let i = 0; i < TOTAL_MINUTES; i++) {
    const agg = grid[i];
    if (!agg) continue;
    const rsi = agg.rsi;
    let signal: Signal = null;

    if (state.position === "long" && sma[i] != null && agg.close < sma[i]!) {
      signal = "exit";
      state.netProfit += agg.close - state.entryPrice!;
      state.position = null;
      state.entryPrice = null;
    } else if (state.position === "short" && sma[i] != null && agg.close > sma[i]!) {
      signal = "exit";
      state.netProfit += state.entryPrice! - agg.close;
      state.position = null;
      state.entryPrice = null;
    }

    if (state.position == null && rsi != null) {
      if (rsi > 65 && (upper[i] == null || agg.close <= upper[i]!)) {
        if (sma[i] == null || agg.close >= sma[i]!) {
          signal = "buy";
          state.position = "long";
          state.entryPrice = agg.close;
        }
      } else if (rsi < 35 && (lower[i] == null || agg.close >= lower[i]!)) {
        if (sma[i] == null || agg.close <= sma[i]!) {
          signal = "sell";
          state.position = "short";
          state.entryPrice = agg.close;
        }
      }
    }

    agg.signal = signal;
  }

  return state;
}

export function computeIncrementalSignal(
  state: SignalState,
  agg: MinuteAggregatePayload,
  allAggregates: MinuteAggregatePayload[],
): Signal {
  const grid: (MinuteAggregatePayload | null)[] = new Array(TOTAL_MINUTES).fill(null);
  for (const a of allAggregates) {
    const slot = minuteKeyToSlot(a.minute);
    if (slot >= 0 && slot < TOTAL_MINUTES) grid[slot] = a;
  }

  const slot = minuteKeyToSlot(agg.minute);
  if (slot < 0 || slot >= TOTAL_MINUTES) return null;

  const { sma, upper, lower } = computeBollingerBands(grid);

  const rsi = agg.rsi;
  let signal: Signal = null;

  if (state.position === "long" && sma[slot] != null && agg.close < sma[slot]!) {
    signal = "exit";
    state.netProfit += agg.close - state.entryPrice!;
    state.position = null;
    state.entryPrice = null;
  } else if (state.position === "short" && sma[slot] != null && agg.close > sma[slot]!) {
    signal = "exit";
    state.netProfit += state.entryPrice! - agg.close;
    state.position = null;
    state.entryPrice = null;
  }

  if (state.position == null && rsi != null) {
    if (rsi > 65 && (upper[slot] == null || agg.close <= upper[slot]!)) {
      if (sma[slot] == null || agg.close >= sma[slot]!) {
        signal = "buy";
        state.position = "long";
        state.entryPrice = agg.close;
      }
    } else if (rsi < 35 && (lower[slot] == null || agg.close >= lower[slot]!)) {
      if (sma[slot] == null || agg.close <= sma[slot]!) {
        signal = "sell";
        state.position = "short";
        state.entryPrice = agg.close;
      }
    }
  }

  return signal;
}
