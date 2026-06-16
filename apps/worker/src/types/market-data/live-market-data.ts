/**
 * Live market data response from Paytm Money API (mode=FULL).
 * Endpoint: /data/v1/price/live?mode=FULL&pref=EXCHANGE:SCRIP_ID:SCRIP_TYPE
 *
 * Each entry in `data` contains full market snapshot for a scrip.
 */
export interface LiveMarketDataResponse {
  data?: LiveMarketDataEntry[];
  [key: string]: unknown;
}

export interface LiveMarketDataEntry {
  found?: boolean;
  message?: string;
  /** Last traded price */
  last_price: number;
  /** Day's open price */
  open: number;
  /** Day's high price */
  high: number;
  /** Day's low price */
  low: number;
  /** Previous day's close */
  close: number;
  /** Change from previous close */
  change: number;
  /** Percentage change from previous close */
  change_percent: number;
  /** Total volume traded today */
  volume: number;
  /** Open interest (for F&O) */
  oi: number;
  /** Lower circuit limit */
  lower_circuit: number;
  /** Upper circuit limit */
  upper_circuit: number;
  /** Total buy quantity in the order book */
  total_buy_qty: number;
  /** Total sell quantity in the order book */
  total_sell_qty: number;
  /** Timestamp of last trade */
  last_traded_time: string;
  /** Exchange segment */
  exchange: string;
  /** Security ID */
  security_id: number;
  /** Allow anything else from the API */
  [key: string]: unknown;
}
