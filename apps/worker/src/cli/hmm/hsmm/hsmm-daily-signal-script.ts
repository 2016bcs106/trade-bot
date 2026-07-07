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

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "..", "..", "..", "..", "data");

const STRATEGY_KEY = "HSMM_REGIME_FLIP";
const MIN_CONFIDENCE = 0.6;
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
  private processedCount = 0;
  private buyCount = 0;
  private sellCount = 0;
  private errorCount = 0;

  get scriptName(): string {
    return "hsmm-daily-signal";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      "Processed": this.processedCount,
      "BUY": this.buyCount,
      "SELL": this.sellCount,
      "Errors": this.errorCount,
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
    const heldSymbolsPaytm = await this.firebase.getPortfolioHoldingSymbols();
    const heldSymbolsDhan = await this.firebase.getDhanPortfolioHoldingSymbols();
    const buySymbols: string[] = [];
    const sellSymbolsPaytm: string[] = [];
    const sellSymbolsDhan: string[] = [];

    for (const stock of recommended) {
      try {
        const result = this.computeSignal(stock);
        if (!result) continue;

        if (result.confidence <= MIN_CONFIDENCE) {
          this.log.info(`${stock.symbol}: skipped — confidence ${(result.confidence * 100).toFixed(1)}% <= ${MIN_CONFIDENCE * 100}%`);
          this.processedCount++;
          continue;
        }

        if (result.signal === "SELL") {
          const inPaytm = heldSymbolsPaytm.has(stock.symbol);
          const inDhan = heldSymbolsDhan.has(stock.symbol);
          if (!inPaytm && !inDhan) {
            this.log.info(`${stock.symbol}: SELL skipped — not held in Paytm Money or Dhan`);
            this.processedCount++;
            continue;
          }
          await this.firebase.setSignal(STRATEGY_KEY, date, stock.symbol, result);
          this.sellCount++;
          if (inPaytm) sellSymbolsPaytm.push(stock.symbol);
          if (inDhan) sellSymbolsDhan.push(stock.symbol);
        } else {
          await this.firebase.setSignal(STRATEGY_KEY, date, stock.symbol, result);
          this.buyCount++;
          buySymbols.push(stock.symbol);
        }
        this.processedCount++;
        this.log.info(`${stock.symbol}: ${result.signal} (confidence=${result.confidence.toFixed(3)})`);
      } catch (err) {
        this.errorCount++;
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`${stock.symbol} — failed: ${msg}`);
      }
    }

    const updatedAt = nowISO();
    await this.firebase.setSignalsSummary({
      buyCount: buySymbols.length,
      sellCount: sellSymbolsPaytm.length,
      buySymbols,
      sellSymbols: sellSymbolsPaytm,
      updatedAt,
    });
    await this.firebase.setDhanSignalsSummary({
      buyCount: buySymbols.length,
      sellCount: sellSymbolsDhan.length,
      buySymbols,
      sellSymbols: sellSymbolsDhan,
      updatedAt,
    });

    this.log.info(`Done — processed=${this.processedCount}, BUY=${this.buyCount}, SELL=${this.sellCount}, errors=${this.errorCount}`);
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
