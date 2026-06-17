export interface DhanHolding {
  exchange: string;
  tradingSymbol: string;
  securityId: string;
  isin: string;
  totalQty: number;
  dpQty: number;
  t1Qty: number;
  availableQty: number;
  collateralQty: number;
  avgCostPrice: number;
  [key: string]: unknown;
}

export interface DhanPosition {
  dhanClientId: string;
  tradingSymbol: string;
  securityId: string;
  positionType: "LONG" | "SHORT" | "CLOSED";
  exchangeSegment: string;
  productType: string;
  buyAvg: number;
  buyQty: number;
  costPrice: number;
  sellAvg: number;
  sellQty: number;
  netQty: number;
  realizedProfit: number;
  unrealizedProfit: number;
  multiplier: number;
  [key: string]: unknown;
}
