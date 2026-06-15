import "../config/env.ts";
import BaseScript from "./base-script.ts";
import { nowISO } from "../utils/time.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";
import {
  PaytmHolding,
  PaytmHoldingsValue,
  PaytmPosition,
  PortfolioHoldings,
  PortfolioPositions,
} from "../types/market-data/portfolio.ts";

class PortfolioSyncScript extends BaseScript {
  private client = new PaytmMoneyClient();
  private holdingsCount = 0;
  private positionsCount = 0;
  private sampleHolding: PaytmHolding | null = null;
  private samplePosition: PaytmPosition | null = null;

  get scriptName(): string {
    return "portfolio-sync";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      "Holdings": this.holdingsCount,
      "Open positions": this.positionsCount,
      "Sample holding": this.sampleHolding,
      "Sample position": this.samplePosition,
    };
  }

  protected async run(): Promise<void> {
    const accessToken = await this.firebase.getAccessToken();

    const [holdingsRes, holdingsValueRes, positionsRes] = await Promise.all([
      this.client.fetchHoldings(accessToken),
      this.client.fetchHoldingsValue(accessToken),
      this.client.fetchPositions(accessToken),
    ]);

    const holdings = holdingsRes.data?.results ?? [];
    const positions = positionsRes.data ?? [];

    this.sampleHolding = holdings[0] ?? null;
    this.samplePosition = positions[0] ?? null;

    const normalizedHoldings = this.normalizeHoldings(holdings, holdingsValueRes.data?.results?.[0]);
    const normalizedPositions = this.normalizePositions(positions);

    this.holdingsCount = normalizedHoldings.items.length;
    this.positionsCount = normalizedPositions.items.length;

    await Promise.all([
      this.firebase.setPortfolioHoldings(normalizedHoldings),
      this.firebase.setPortfolioPositions(normalizedPositions),
    ]);

    this.log.info(`Synced ${this.holdingsCount} holdings, ${this.positionsCount} open positions`);
  }

  private normalizeHoldings(holdings: PaytmHolding[], holdingsValue?: PaytmHoldingsValue): PortfolioHoldings {
    const items = holdings.map((h) => {
      const quantity = Number(h.quantity) || 0;
      const avgPrice = Number(h.cost_price) || 0;
      const ltp = Number(h.last_traded_price) || 0;
      const closePrice = Number(h.pc) || ltp;
      const investedValue = avgPrice * quantity;
      const currentValue = ltp * quantity;
      const dayChange = (ltp - closePrice) * quantity;
      const dayChangePct = closePrice !== 0 ? ((ltp - closePrice) / closePrice) * 100 : 0;
      const pnl = currentValue - investedValue;
      const pnlPct = investedValue !== 0 ? (pnl / investedValue) * 100 : 0;

      return {
        symbol: h.nse_symbol,
        isin: h.isin_code,
        quantity,
        avgPrice,
        ltp,
        investedValue,
        currentValue,
        dayChange,
        dayChangePct,
        pnl,
        pnlPct,
      };
    });

    const investedValue = holdingsValue ? Number(holdingsValue.iv) : items.reduce((sum, i) => sum + i.investedValue, 0);
    const currentValue = holdingsValue ? Number(holdingsValue.cv) : items.reduce((sum, i) => sum + i.currentValue, 0);
    const dayChange = items.reduce((sum, i) => sum + i.dayChange, 0);
    const previousValue = currentValue - dayChange;
    const dayChangePct = previousValue !== 0 ? (dayChange / previousValue) * 100 : 0;

    return {
      summary: {
        investedValue,
        currentValue,
        dayChange,
        dayChangePct,
        totalStocks: items.length,
        updatedAt: nowISO(),
      },
      items,
    };
  }

  private normalizePositions(positions: PaytmPosition[]): PortfolioPositions {
    const items = positions
      .filter((p) => Number(p.net_qty) !== 0)
      .map((p) => {
        const quantity = Number(p.net_qty) || 0;
        const avgPrice = Number(p.net_avg) || 0;
        const ltp = Number(p.last_traded_price) || 0;
        const absQty = Math.abs(quantity);
        const investedValue = avgPrice * absQty;
        const currentValue = ltp * absQty;
        const pnl = p.realised_profit != null
          ? Number(p.realised_profit)
          : (quantity >= 0 ? currentValue - investedValue : investedValue - currentValue);
        const pnlPct = investedValue !== 0 ? (pnl / investedValue) * 100 : 0;

        return {
          symbol: p.display_name,
          quantity,
          avgPrice,
          ltp,
          investedValue,
          currentValue,
          pnl,
          pnlPct,
          product: p.product,
        };
      });

    const investedValue = items.reduce((sum, i) => sum + i.investedValue, 0);
    const currentValue = items.reduce((sum, i) => sum + i.currentValue, 0);
    const netPnl = items.reduce((sum, i) => sum + i.pnl, 0);

    return {
      summary: { investedValue, currentValue, netPnl, totalStocks: items.length, updatedAt: nowISO() },
      items,
    };
  }
}

new PortfolioSyncScript().start();
