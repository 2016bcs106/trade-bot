/**
 * Holdings (long-term, non-intraday) — Paytm Money API.
 * Endpoint: GET /holdings/v1/get-user-holdings-data
 */
export interface PaytmHoldingsResponse {
  data?: { results?: PaytmHolding[] };
  [key: string]: unknown;
}

export interface PaytmHolding {
  nse_symbol: string;
  isin_code: string;
  exchange: string;
  nse_security_id: string;
  /** Numeric strings as returned by the API */
  quantity: string;
  cost_price: string;
  last_traded_price: string;
  /** Previous day's closing price */
  pc: number;
  [key: string]: unknown;
}

/**
 * Portfolio-level holdings value summary — Paytm Money API.
 * Endpoint: GET /holdings/v1/get-holdings-value
 */
export interface PaytmHoldingsValueResponse {
  data?: { results?: PaytmHoldingsValue[] };
  [key: string]: unknown;
}

export interface PaytmHoldingsValue {
  /** Current value (numeric string) */
  cv: string;
  /** Invested value (numeric string) */
  iv: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Open positions (intraday + carry-forward) — Paytm Money API.
 * Endpoint: GET /orders/v1/position
 */
export interface PaytmPositionsResponse {
  data?: PaytmPosition[];
  [key: string]: unknown;
}

export interface PaytmPosition {
  display_name: string;
  isin: string;
  exchange: string;
  segment?: string;
  product: string;
  security_id: number | string;
  net_qty: number;
  net_avg: number;
  last_traded_price: number;
  realised_profit?: number;
  [key: string]: unknown;
}

// ─── Funds summary — written to Firebase ─────────────────────────────────

export interface FundsSummary {
  availableBalance: number;
  utilisedAmount: number;
  openingBalance: number;
  updatedAt: string;
}

// ─── Normalized shapes written to Firebase ──────────────────────────────

export interface PortfolioHoldingItem {
  symbol: string;
  isin: string;
  quantity: number;
  avgPrice: number;
  ltp: number;
  investedValue: number;
  currentValue: number;
  dayChange: number;
  dayChangePct: number;
  pnl: number;
  pnlPct: number;
}

export interface PortfolioHoldingsSummary {
  investedValue: number;
  currentValue: number;
  dayChange: number;
  dayChangePct: number;
  totalStocks: number;
  updatedAt: string;
}

export interface PortfolioHoldings {
  summary: PortfolioHoldingsSummary;
  items: PortfolioHoldingItem[];
}

export interface PortfolioPositionItem {
  symbol: string;
  quantity: number;
  avgPrice: number;
  ltp: number;
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  product: string;
}

export interface PortfolioPositionsSummary {
  investedValue: number;
  currentValue: number;
  netPnl: number;
  totalStocks: number;
  updatedAt: string;
}

export interface PortfolioPositions {
  summary: PortfolioPositionsSummary;
  items: PortfolioPositionItem[];
}
