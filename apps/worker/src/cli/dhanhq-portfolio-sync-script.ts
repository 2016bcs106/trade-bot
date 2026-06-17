import "../config/env.ts";
import BaseScript from "./base-script.ts";
import { nowISO } from "../utils/time.ts";
import DhanhqClient from "../data/providers/dhanhq-client.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";
import { DhanHolding, DhanPosition } from "../types/market-data/dhanhq-portfolio.ts";
import { PortfolioHoldings, PortfolioPositions } from "../types/market-data/portfolio.ts";

class DhanhqPortfolioSyncScript extends BaseScript {
  private dhan = new DhanhqClient();
  private paytm = new PaytmMoneyClient();
  private holdingsCount = 0;
  private positionsCount = 0;

  get scriptName(): string {
    return "dhanhq-portfolio-sync";
  }

  protected getMetadata(): Record<string, unknown> {
    return { Holdings: this.holdingsCount, "Open positions": this.positionsCount };
  }

  protected async run(): Promise<void> {
    const creds = await this.firebase.getValue("dhanhq/credentials") as {
      clientId: string;
      accessToken: string;
    } | null;

    if (!creds?.clientId || !creds?.accessToken) {
      throw new Error("dhanhq/credentials missing or incomplete in Firebase");
    }

    const { clientId, accessToken: dhanToken } = creds;
    const paytmToken = await this.firebase.getAccessToken();

    const [holdings, positions] = await Promise.all([
      this.dhan.fetchHoldings(dhanToken, clientId),
      this.dhan.fetchPositions(dhanToken, clientId),
    ]);

    // Collect all security IDs needing LTP from Paytm Money
    const holdingSecIds = holdings.map((h) => Number(h.securityId)).filter((id) => id > 0);
    const positionSecIds = positions
      .filter((p) => p.netQty !== 0)
      .map((p) => Number(p.securityId))
      .filter((id) => id > 0);

    const allSecIds = [...new Set([...holdingSecIds, ...positionSecIds])];
    const livePrices = allSecIds.length > 0
      ? await this.paytm.fetchLivePrices(allSecIds, "NSE", paytmToken)
      : new Map<number, number>();

    const normalizedHoldings = this.normalizeHoldings(holdings, livePrices);
    const normalizedPositions = this.normalizePositions(positions, livePrices);

    this.holdingsCount = normalizedHoldings.items.length;
    this.positionsCount = normalizedPositions.items.length;

    await Promise.all([
      this.firebase.setDhanhqPortfolioHoldings(normalizedHoldings),
      this.firebase.setDhanhqPortfolioPositions(normalizedPositions),
    ]);

    this.log.info(`Synced ${this.holdingsCount} holdings, ${this.positionsCount} open positions`);
  }

  private normalizeHoldings(holdings: DhanHolding[], livePrices: Map<number, number>): PortfolioHoldings {
    const items = holdings.map((h) => {
      const quantity = h.totalQty;
      const avgPrice = h.avgCostPrice;
      const secId = Number(h.securityId);
      const ltp = livePrices.get(secId) ?? 0;
      const investedValue = avgPrice * quantity;
      const currentValue = ltp > 0 ? ltp * quantity : investedValue;
      const pnl = currentValue - investedValue;
      const pnlPct = investedValue !== 0 ? (pnl / investedValue) * 100 : 0;

      return {
        symbol: h.tradingSymbol,
        isin: h.isin,
        quantity,
        avgPrice,
        ltp,
        investedValue,
        currentValue,
        dayChange: 0,
        dayChangePct: 0,
        pnl,
        pnlPct,
      };
    });

    const investedValue = items.reduce((sum, i) => sum + i.investedValue, 0);
    const currentValue = items.reduce((sum, i) => sum + i.currentValue, 0);

    return {
      summary: {
        investedValue,
        currentValue,
        dayChange: 0,
        dayChangePct: 0,
        totalStocks: items.length,
        updatedAt: nowISO(),
      },
      items,
    };
  }

  private normalizePositions(positions: DhanPosition[], livePrices: Map<number, number>): PortfolioPositions {
    const items = positions
      .filter((p) => p.netQty !== 0)
      .map((p) => {
        const quantity = p.netQty;
        const avgPrice = p.costPrice || p.buyAvg;
        const secId = Number(p.securityId);
        const ltp = livePrices.get(secId) ?? 0;
        const absQty = Math.abs(quantity);
        const investedValue = avgPrice * absQty;
        const currentValue = ltp > 0 ? ltp * absQty : investedValue;
        const pnl = p.unrealizedProfit + p.realizedProfit;
        const pnlPct = investedValue !== 0 ? (pnl / investedValue) * 100 : 0;

        return {
          symbol: p.tradingSymbol,
          quantity,
          avgPrice,
          ltp,
          investedValue,
          currentValue,
          pnl,
          pnlPct,
          product: p.productType,
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

new DhanhqPortfolioSyncScript().start();
