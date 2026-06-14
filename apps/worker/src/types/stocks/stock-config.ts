export interface StockConfig {
  symbol: string;
  name: string;
  securityId: number | string;
  pmlId: string;
  isin?: string;
  industryName?: string;
  mcap?: number;
  tickSize?: number;
  lotSize?: number;
  exchange: "NSE" | "BSE";
  addedAt: string;
  updatedAt: string;
  status?: "pending_sync" | "sync_failed" | "synced" | "ready";
  notifySignals?: boolean;
  isTopStock?: boolean;
  recommendationData?: Record<string, Record<string, unknown>>;
}
