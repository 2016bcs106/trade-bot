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
  lastUpdatedAt: string;
}

export interface PriceInfo {
  price: number;
  change: number;
  changePct: number;
}
