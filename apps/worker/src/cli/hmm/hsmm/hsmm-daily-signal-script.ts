import "../../../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { nowISO, todayDate } from "../../../utils/time.ts";
import BaseScript from "../../base-script.ts";
import { GaussianParams } from "../types/gaussian-params.ts";
import { OHLCV } from "../../../types/market-data/ohlcv.ts";
import { StockConfig } from "../../../types/stocks/stock-config.ts";
import { forwardLogAlpha } from "../forward-backward.ts";
import { logSumExp } from "../utils/math.ts";
import { computeLogReturns } from "../utils/returns.ts";
import { buildExpandedA, buildExpandedEmissions, buildExpandedPi, expandedIndex } from "./expand.ts";
import DhanhqClient from "../../../data/providers/dhanhq-client.ts";
import PaytmMoneyClient from "../../../data/providers/paytm-money-client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "..", "..", "..", "..", "data");

const STRATEGY_KEY = "HSMM_REGIME_FLIP";
const N = 3;
const D = 20;
const uniformPi = Array(N).fill(1 / N);

interface ModelParams {
  A: number[][];
  pi: number[];
  durations: number[][];
  emissionParams: GaussianParams[];
}

class HsmmDailySignalScript extends BaseScript {
  private dhan = new DhanhqClient();
  private paytm = new PaytmMoneyClient();
  private processedCount = 0;
  private buyCount = 0;
  private sellCount = 0;
  private errorCount = 0;
  private tradeLog: string[] = [];

  get scriptName(): string {
    return "hsmm-daily-signal";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      "Processed": this.processedCount,
      "BUY": this.buyCount,
      "SELL": this.sellCount,
      "Errors": this.errorCount,
      "Trades": this.tradeLog,
    };
  }

  protected async run(): Promise<void> {
    const symbolsArg = process.argv.find((a) => a.startsWith("--symbols="));
    const symbolsFilter = symbolsArg
      ? new Set(symbolsArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean))
      : null;

    const stocks = await this.firebase.getAllStocks();
    const recommended = Object.values(stocks).filter((s) =>
      s.recommendationData?.[STRATEGY_KEY]?.recommended === true && (!symbolsFilter || symbolsFilter.has(s.symbol)));

    this.log.info(`Computing signals for ${recommended.length} recommended stocks`);

    const date = todayDate();
    const heldSymbols = await this.firebase.getPortfolioHoldingSymbols();
    const buySymbols: string[] = [];
    const sellSymbols: string[] = [];

    for (const stock of recommended) {
      try {
        const result = this.computeSignal(stock);
        if (!result) continue;

        if (result.signal === "SELL" && !heldSymbols.has(stock.symbol)) {
          this.log.info(`${stock.symbol}: SELL skipped — not held in portfolio`);
          this.processedCount++;
          continue;
        }

        await this.firebase.setSignal(STRATEGY_KEY, date, stock.symbol, result);
        if (result.signal === "BUY") { this.buyCount++; buySymbols.push(stock.symbol); }
        else { this.sellCount++; sellSymbols.push(stock.symbol); }
        this.processedCount++;
        this.log.info(`${stock.symbol}: ${result.signal} (confidence=${result.confidence.toFixed(3)})`);
      } catch (err) {
        this.errorCount++;
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`${stock.symbol} — failed: ${msg}`);
      }
    }

    await this.firebase.setSignalsSummary({
      buyCount: this.buyCount,
      sellCount: this.sellCount,
      buySymbols,
      sellSymbols,
      updatedAt: nowISO(),
    });

    this.log.info(`Done — processed=${this.processedCount}, BUY=${this.buyCount}, SELL=${this.sellCount}, errors=${this.errorCount}`);

    const autoTradeEnabled = await this.firebase.getConfig("dhanAutoTrade");
    if (autoTradeEnabled) {
      await this.runAutoTrade(buySymbols, sellSymbols, recommended);
    } else {
      this.log.info("Auto-trade disabled — skipping");
    }
  }

  private async runAutoTrade(buySymbols: string[], sellSymbols: string[], recommended: StockConfig[]): Promise<void> {
    const creds = await this.firebase.getValue("dhanhq/credentials") as { clientId: string; accessToken: string } | null;
    if (!creds?.clientId || !creds?.accessToken) {
      this.log.error("Auto-trade: dhanhq/credentials missing");
      return;
    }
    const { clientId, accessToken } = creds;
    const stockMap = new Map(recommended.map((s) => [s.symbol, s]));

    // ── Sell phase ────────────────────────────────────────────────────────────
    const holdings = await this.dhan.fetchHoldings(accessToken, clientId);
    const holdingsBySymbol = new Map(holdings.map((h) => [h.tradingSymbol, h]));

    for (const symbol of sellSymbols) {
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

    const buyCandidates = buySymbols
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

  /**
   * Runs forwardLogAlpha over the full observation history using the persisted
   * modelParams, and reads the causal regime probabilities at the last timestep.
   */
  private computeSignal(stock: StockConfig): { signal: string; confidence: number } | null {
    const path = resolve(DATA_DIR, "daily-ohlcv", `${stock.symbol}.json`);
    if (!existsSync(path)) {
      this.log.warn(`${stock.symbol} — no data file`);
      return null;
    }

    const modelParams = stock.recommendationData![STRATEGY_KEY].modelParams as ModelParams;

    const ohlcv = JSON.parse(readFileSync(path, "utf-8")) as OHLCV[];
    const closes = ohlcv.map((c) => c.close);
    const observations = computeLogReturns(closes);

    const expandedA = buildExpandedA(modelParams.A, modelParams.durations);
    const expandedPi = buildExpandedPi(uniformPi, modelParams.durations);
    const expandedEmissions = buildExpandedEmissions(modelParams.emissionParams, D);
    const logAlpha = forwardLogAlpha(observations, expandedA, expandedPi, expandedEmissions);

    const upIdx = [0, 1, 2].sort((a, b) => modelParams.emissionParams[b].mean - modelParams.emissionParams[a].mean)[0];

    const t = observations.length - 1;
    const logNorm = logSumExp(logAlpha[t]);
    const moodProbs = Array(N).fill(0);
    for (let j = 0; j < N; j++) {
      let p = 0;
      for (let r = 1; r <= D; r++) {
        p += Math.exp(logAlpha[t][expandedIndex(j, r, D)] - logNorm);
      }
      moodProbs[j] = p;
    }

    const mostLikely = moodProbs.indexOf(Math.max(...moodProbs));
    return {
      signal: mostLikely === upIdx ? "BUY" : "SELL",
      confidence: moodProbs[upIdx],
    };
  }
}

new HsmmDailySignalScript().start();
