import "../../../config/env.ts";
import BaseScript from "../../base-script.ts";
import DhanhqClient from "../../../data/providers/dhanhq-client.ts";
import PaytmMoneyClient from "../../../data/providers/paytm-money-client.ts";

const STRATEGY_KEY = "HSMM_REGIME_FLIP";

class HsmmAutoTradeScript extends BaseScript {
  private dhan = new DhanhqClient();
  private paytm = new PaytmMoneyClient();
  private tradeLog: string[] = [];

  get scriptName(): string {
    return "hsmm-auto-trade";
  }

  protected getMetadata(): Record<string, unknown> {
    return { "Trades": this.tradeLog };
  }

  protected async run(): Promise<void> {
    const autoTradeEnabled = await this.firebase.getConfig("dhanAutoTrade");
    if (!autoTradeEnabled) {
      this.log.info("Auto-trade disabled — skipping");
      return;
    }

    const summary = await this.firebase.getDhanSignalsSummary();
    if (!summary) {
      this.log.info("No signals summary found — skipping");
      return;
    }

    const creds = await this.firebase.getValue("dhanhq/credentials") as { clientId: string; accessToken: string } | null;
    if (!creds?.clientId || !creds?.accessToken) {
      this.log.error("Auto-trade: dhanhq/credentials missing");
      return;
    }
    const { clientId, accessToken } = creds;

    const stocks = await this.firebase.getAllStocks();
    const stockMap = new Map(Object.values(stocks).map((s) => [s.symbol, s]));

    // ── Sell phase ────────────────────────────────────────────────────────────
    const holdings = await this.dhan.fetchHoldings(accessToken, clientId);
    const holdingsBySymbol = new Map(holdings.map((h) => [h.tradingSymbol, h]));

    for (const symbol of summary.sellSymbols) {
      const holding = holdingsBySymbol.get(symbol);
      if (!holding || holding.totalQty <= 0) {
        this.log.info(`Auto-trade SELL skip ${symbol} — not in Dhan holdings`);
        continue;
      }
      const stock = stockMap.get(symbol);
      if (!stock?.securityId) continue;
      try {
        const result = await this.dhan.placeOrder(accessToken, clientId, {
          securityId: String(stock.securityId),
          transactionType: "SELL",
          quantity: holding.totalQty,
          afterMarketOrder: true,
          amoTime: "PRE_OPEN",
        });
        const entry = `SELL ${symbol} qty=${holding.totalQty} orderId=${result.orderId} status=${result.orderStatus}`;
        this.tradeLog.push(entry);
        this.log.info(`Auto-trade ${entry}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`Auto-trade SELL ${symbol} failed: ${msg}`);
      }
    }

    // ── Buy phase ─────────────────────────────────────────────────────────────
    const funds = await this.dhan.fetchFunds(accessToken, clientId);
    let balance = funds?.availabelBalance ?? 0;
    this.log.info(`Auto-trade buy budget: ₹${balance.toFixed(2)}`);

    const buyCandidates = summary.buySymbols
      .map((symbol) => {
        const stock = stockMap.get(symbol);
        const strategyReturn = (stock?.recommendationData?.[STRATEGY_KEY]?.strategyTotalReturn as number) ?? 0;
        return { symbol, stock, strategyReturn };
      })
      .filter((c) => c.stock && Number(c.stock.securityId) > 0)
      .sort((a, b) => b.strategyReturn - a.strategyReturn);

    const paytmToken = await this.firebase.getAccessToken();
    const secIds = buyCandidates.map((c) => Number(c.stock!.securityId));
    const livePrices = await this.paytm.fetchLivePrices(secIds, "NSE", paytmToken);

    for (const { symbol, stock } of buyCandidates) {
      const ltp = livePrices.get(Number(stock!.securityId)) ?? 0;
      if (ltp <= 0) {
        this.log.info(`Auto-trade BUY skip ${symbol} — no LTP`);
        continue;
      }
      if (balance < ltp) {
        this.log.info(`Auto-trade BUY skip ${symbol} — insufficient balance (₹${balance.toFixed(2)} < ₹${ltp})`);
        continue;
      }
      try {
        const result = await this.dhan.placeOrder(accessToken, clientId, {
          securityId: String(stock!.securityId),
          transactionType: "BUY",
          quantity: 1,
          afterMarketOrder: true,
          amoTime: "PRE_OPEN",
        });
        balance -= ltp;
        const entry = `BUY ${symbol} qty=1 ltp=${ltp} orderId=${result.orderId} status=${result.orderStatus} remaining=₹${balance.toFixed(2)}`;
        this.tradeLog.push(entry);
        this.log.info(`Auto-trade ${entry}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`Auto-trade BUY ${symbol} failed: ${msg}`);
      }
    }
  }
}

new HsmmAutoTradeScript().start();
