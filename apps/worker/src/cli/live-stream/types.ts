export type Signal = "buy" | "sell" | "exit" | null;

export interface MinuteAggregatePayload {
  instrumentKey: string;
  symbol: string;
  displayName: string;
  exchangeType: string;
  scripType: string;
  scripId: number;
  minute: string;
  dateIst: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickCount: number;
  buyQtySum: number;
  sellQtySum: number;
  buySellRatio: number | null;
  rsi: number | null;
  signal: Signal;
  lastUpdatedAt: string;
}

export interface PriceInfo {
  price: number;
  change: number;
  changePct: number;
}
