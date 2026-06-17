import { StockConfig } from "../../types/stocks/stock-config.ts";
import AggregateStore from "./aggregate-store.ts";

export default class StockRegistry {
  private _stocks: StockConfig[] = [];
  private _instrumentByKey = new Map<string, StockConfig>();
  private _instrumentBySecurityId = new Map<number, StockConfig>();
  private _relevanceScores = new Map<string, number>();
  private _favorites = new Set<string>();

  get stocks(): StockConfig[] { return this._stocks; }
  get instrumentByKey(): Map<string, StockConfig> { return this._instrumentByKey; }
  get favorites(): Set<string> { return this._favorites; }

  setStocks(stocks: StockConfig[]): void {
    this._stocks = stocks;
    this._instrumentByKey.clear();
    this._instrumentBySecurityId.clear();
    for (const stock of stocks) {
      const key = this.getInstrumentKey(stock);
      this._instrumentByKey.set(key, stock);
      this._instrumentBySecurityId.set(this.getScripId(stock), stock);
    }
  }

  setFavorites(symbols: string[]): void {
    this._favorites = new Set(symbols);
  }

  getScripId(stock: StockConfig): number {
    return typeof stock.securityId === "string" ? parseInt(stock.securityId, 10) : stock.securityId;
  }

  getInstrumentKey(stock: StockConfig): string {
    return `${stock.exchange}:EQUITY:${this.getScripId(stock)}`;
  }

  resolveStockFromTick(tick: Record<string, unknown>): StockConfig | null {
    const securityId = Number(tick.security_id);
    if (!Number.isFinite(securityId)) return null;
    return this._instrumentBySecurityId.get(securityId) ?? null;
  }

  computeRelevanceScores(aggregateStore: AggregateStore): void {
    for (const stock of this._stocks) {
      const key = this.getInstrumentKey(stock);
      const data = aggregateStore.getSnapshotData(key);
      if (data.length === 0) { this._relevanceScores.set(stock.symbol, 0); continue; }

      const recent = data.slice(-60).reverse();
      const byActivity = recent
        .map((m) => ({ peak: Math.max(m.buyQtySum, m.sellQtySum), diff: Math.abs(m.buyQtySum - m.sellQtySum) }))
        .sort((a, b) => b.peak - a.peak);

      const topHalf = byActivity.slice(0, Math.max(1, Math.ceil(byActivity.length / 2)));
      let sum = 0, count = 0;
      for (const m of topHalf) {
        if (m.peak === 0) continue;
        sum += m.diff / m.peak;
        count++;
      }
      this._relevanceScores.set(stock.symbol, count > 0 ? sum / count : 0);
    }
  }

  buildStockList(): Record<string, unknown>[] {
    return this._stocks.map((stock) => {
      const recommended = Object.entries(stock.recommendationData ?? {})
        .filter(([, data]) => data?.recommended === true);

      return {
        instrumentKey: this.getInstrumentKey(stock),
        symbol: stock.symbol,
        displayName: stock.name,
        exchangeType: stock.exchange,
        scripType: "EQUITY",
        scripId: this.getScripId(stock),
        isin: stock.isin,
        pmlId: stock.pmlId,
        industryName: stock.industryName,
        mcap: stock.mcap,
        addedAt: stock.addedAt,
        updatedAt: stock.updatedAt,
        status: stock.status,
        isFavorite: this._favorites.has(stock.symbol),
        isNotified: !!stock.notifySignals,
        relevanceScore: this._relevanceScores.get(stock.symbol) ?? 0,
        recommendedStrategies: recommended.map(([key]) => key),
        recommendedRank: recommended.length > 0
          ? (recommended[0][1].rank as number | null)
          : null,
        estimatedProfitPct: recommended.length > 0
          ? (recommended[0][1].strategyTotalReturn as number) * 100
          : null,
      };
    });
  }

  buildFavoritePrices(aggregateStore: AggregateStore): { instrumentKey: string; symbol: string; price: number; change: number; changePct: number }[] {
    const prices: { instrumentKey: string; symbol: string; price: number; change: number; changePct: number }[] = [];
    for (const stock of this._stocks) {
      if (!this._favorites.has(stock.symbol)) continue;
      const instrumentKey = this.getInstrumentKey(stock);
      const priceInfo = aggregateStore.getPrice(instrumentKey);
      if (priceInfo) prices.push({ instrumentKey, symbol: stock.symbol, ...priceInfo });
    }
    return prices;
  }
}
