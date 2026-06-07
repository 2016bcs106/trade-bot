import { MinuteAggregatePayload } from "./types.ts";

export interface RsiState {
  avgGain: number;
  avgLoss: number;
  prevRatio: number;
  count: number;
  seeded: boolean;
}

const RSI_PERIOD = 14;

export function createRsiState(): RsiState {
  return { avgGain: 0, avgLoss: 0, prevRatio: 0, count: 0, seeded: false };
}

export function computeFullRsi(aggregates: MinuteAggregatePayload[]): { rsiValues: (number | null)[]; state: RsiState } {
  const state = createRsiState();
  const rsiValues: (number | null)[] = new Array(aggregates.length).fill(null);

  for (let i = 0; i < aggregates.length; i++) {
    const agg = aggregates[i];
    const sell = agg.sellQtySum || 0;
    const ratio = sell > 0 ? agg.buyQtySum / sell : 1;

    if (state.count === 0) {
      state.prevRatio = ratio;
      state.count = 1;
      continue;
    }

    const change = ratio - state.prevRatio;

    if (!state.seeded) {
      if (change > 0) state.avgGain += change; else state.avgLoss -= change;
      state.count++;

      if (state.count === RSI_PERIOD + 1) {
        state.avgGain /= RSI_PERIOD;
        state.avgLoss /= RSI_PERIOD;
        state.seeded = true;
        rsiValues[i] = state.avgLoss === 0 ? 100 : 100 - 100 / (1 + state.avgGain / state.avgLoss);
      }
    } else {
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;
      state.avgGain = (state.avgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD;
      state.avgLoss = (state.avgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD;
      rsiValues[i] = state.avgLoss === 0 ? 100 : 100 - 100 / (1 + state.avgGain / state.avgLoss);
    }

    state.prevRatio = ratio;
  }

  return { rsiValues, state };
}

export function computeIncrementalRsi(state: RsiState, buyQtySum: number, sellQtySum: number): number | null {
  const sell = sellQtySum || 0;
  const ratio = sell > 0 ? buyQtySum / sell : 1;

  if (state.count === 0) {
    state.prevRatio = ratio;
    state.count = 1;
    return null;
  }

  const change = ratio - state.prevRatio;

  if (!state.seeded) {
    if (change > 0) state.avgGain += change; else state.avgLoss -= change;
    state.count++;

    if (state.count === RSI_PERIOD + 1) {
      state.avgGain /= RSI_PERIOD;
      state.avgLoss /= RSI_PERIOD;
      state.seeded = true;
      state.prevRatio = ratio;
      return state.avgLoss === 0 ? 100 : 100 - 100 / (1 + state.avgGain / state.avgLoss);
    }

    state.prevRatio = ratio;
    return null;
  }

  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? -change : 0;
  state.avgGain = (state.avgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD;
  state.avgLoss = (state.avgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD;
  state.prevRatio = ratio;
  return state.avgLoss === 0 ? 100 : 100 - 100 / (1 + state.avgGain / state.avgLoss);
}
