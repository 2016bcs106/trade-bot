import FirebaseClient from "../firebase/client.ts";
import { StockConfig } from "../types/stocks/index.ts";

/**
 * Get list of symbols to process — either a single symbol or all enabled stocks.
 */
export async function getEnabledSymbols(symbol: string | null, all: boolean): Promise<string[]> {
  if (symbol) return [symbol];
  if (all) {
    const firebase = new FirebaseClient();
    const stocks = await firebase.getAllStocks();
    return Object.values(stocks)
      .filter((s: StockConfig) => s.enabled)
      .map((s: StockConfig) => s.symbol);
  }
  return [];
}
