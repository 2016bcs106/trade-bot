import { MinuteAggregatePayload, Signal } from "./types.ts";

export interface SignalState {
  position: "long" | "short" | null;
  entryPrice: number | null;
  netProfit: number;
}

export function createSignalState(): SignalState {
  return { position: null, entryPrice: null, netProfit: 0 };
}

export function computeFullSignals(aggregates: MinuteAggregatePayload[]): SignalState {
  const state = createSignalState();
  const BB_PERIOD = 20;
  const MULTIPLIER = 2;

  const window: number[] = [];
  const sma: (number | null)[] = new Array(aggregates.length).fill(null);
  const upper: (number | null)[] = new Array(aggregates.length).fill(null);
  const lower: (number | null)[] = new Array(aggregates.length).fill(null);

  for (let i = 0; i < aggregates.length; i++) {
    window.push(aggregates[i].close);
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

  for (let i = 0; i < aggregates.length; i++) {
    const agg = aggregates[i];
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

    if (state.position == null && rsi != null && signal == null) {
      if (rsi > 65 && (upper[i] == null || agg.close <= upper[i]!)) {
        signal = "buy";
        state.position = "long";
        state.entryPrice = agg.close;
      } else if (rsi < 35 && (lower[i] == null || agg.close >= lower[i]!)) {
        signal = "sell";
        state.position = "short";
        state.entryPrice = agg.close;
      }
    }

    agg.signal = signal;
  }

  return state;
}

export function computeIncrementalSignal(
  state: SignalState,
  agg: MinuteAggregatePayload,
  sma: number | null,
  upper: number | null,
  lower: number | null,
): Signal {
  const rsi = agg.rsi;
  let signal: Signal = null;

  if (state.position === "long" && sma != null && agg.close < sma) {
    signal = "exit";
    state.netProfit += agg.close - state.entryPrice!;
    state.position = null;
    state.entryPrice = null;
  } else if (state.position === "short" && sma != null && agg.close > sma) {
    signal = "exit";
    state.netProfit += state.entryPrice! - agg.close;
    state.position = null;
    state.entryPrice = null;
  }

  if (state.position == null && rsi != null && signal == null) {
    if (rsi > 65 && (upper == null || agg.close <= upper)) {
      signal = "buy";
      state.position = "long";
      state.entryPrice = agg.close;
    } else if (rsi < 35 && (lower == null || agg.close >= lower)) {
      signal = "sell";
      state.position = "short";
      state.entryPrice = agg.close;
    }
  }

  return signal;
}
