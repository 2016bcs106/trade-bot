/**
 * Stock configuration stored at `stocks/SYMBOL/`
 * Controls whether a stock is actively tracked and how its model lifecycle is managed.
 */
export interface StockConfig {
  /** Stock ticker symbol (e.g., "RELIANCE", "TCS") */
  symbol: string;

  /** Display name (e.g., "Reliance Industries Ltd") */
  name: string;

  /** Paytm Money security ID for data fetching */
  securityId: string;

  /** Exchange: NSE or BSE */
  exchange: "NSE" | "BSE";

  /** Whether predictions are actively generated for this stock */
  enabled: boolean;

  /** Whether the system can auto-promote shadow models to production */
  autoOptimize: boolean;

  /** Current production model version (e.g., "v3"), null if no model trained yet */
  currentProductionVersion: string | null;

  /** ISO timestamp when this stock was added to tracking */
  addedAt: number;

  /** ISO timestamp of last config update */
  updatedAt: number;
}
