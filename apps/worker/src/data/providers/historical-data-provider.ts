import { OHLCV, HistoricalDataRequest } from "../../types/market-data/ohlcv.ts";

/**
 * Abstract interface for historical market data providers.
 * Implements the adapter pattern to allow swapping data sources.
 *
 * Current implementations:
 * - PaytmMoneyHistoricalProvider (Paytm Money charts API)
 *
 * Future implementations could include:
 * - NSE direct API
 * - Yahoo Finance
 * - Alpha Vantage
 * - CSV file reader
 */
export interface HistoricalDataProvider {
  /** Provider name for logging/identification */
  readonly name: string;

  /**
   * Fetch OHLCV candle data for a given stock and date range.
   * Returns data sorted chronologically (oldest first).
   */
  fetchOHLCV(request: HistoricalDataRequest): Promise<OHLCV[]>;

  /**
   * Check if the provider is available/configured.
   * Useful for graceful fallback between providers.
   */
  isAvailable(): Promise<boolean>;
}
