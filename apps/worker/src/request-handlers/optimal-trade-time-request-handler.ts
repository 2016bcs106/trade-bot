import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { now } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { OHLCV } from "../types/market-data/ohlcv.ts";
import { PreviousDayContext } from "../types/features/feature-vector.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";
import { getBusinessDays } from "../utils/market-utils.ts";

const logger = createLogger("handler:optimal-trade-time");

/** Market timing constants */
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MIN = 15;
const STEP = 5; // 5-min intervals

/** Fixed exit time — always exit at 15:14 (1 min before last candle to avoid closing auction noise) */
const FIXED_EXIT_TIME = "15:14";
const FIXED_EXIT_MINUTES = 15 * 60 + 14 - (MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MIN); // offset from 9:15

interface TradeResult {
  entryTime: string;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  date: string;
}

interface StrategyStats {
  entryTime: string;
  exitTime: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  sharpe: number;
  maxDrawdown: number;
  consistency: number;
  score: number;
}

/**
 * Handles "optimal_trade_time" requests — backtests all entry times with a fixed exit (15:14)
 * using horizon models to find the most profitable intraday entry strategy.
 *
 * Expected payload:
 * - symbol: string (stock symbol)
 * - days: number (number of past trading days to backtest, default 90)
 */
export class OptimalTradeTimeRequestHandler implements RequestHandler {
  async handle(request: QueuedRequest, ctx: ServiceContext): Promise<void> {
    const { symbol, days = 90 } = request.payload as {
      symbol: string;
      days?: number;
    };

    if (!symbol) {
      throw new Error("optimal_trade_time requires payload: { symbol, days? }");
    }

    const { firebase, paytm: client, predictionEngine } = ctx;

    const stock = await firebase.getStock(symbol);
    if (!stock || !stock.currentProductionVersion) {
      throw new Error(`No production model for ${symbol}`);
    }

    const pmlId = stock.pmlId;
    const version = stock.currentProductionVersion;
    const modelType = "linear-regression";

    // Compute date range: last N business days ending yesterday
    const yesterday = now().subtract(1, "day").format("YYYY-MM-DD");
    const startDate = now().subtract(days + 15, "day").format("YYYY-MM-DD"); // buffer for weekends/holidays
    const businessDays = getBusinessDays(startDate, yesterday).slice(-days);

    if (businessDays.length === 0) {
      throw new Error(`No business days found in the last ${days} days`);
    }

    logger.info(`Backtesting ${symbol} (${version}): ${businessDays.length} days, ${businessDays[0]} → ${businessDays[businessDays.length - 1]}`);

    // Generate all entry times (9:20 to 14:30) — exit is always fixed at 15:14
    const entryTimes = this.generateTimes(MARKET_OPEN_HOUR, MARKET_OPEN_MIN + STEP, 14, 30);

    // Collect all trade results across all days
    const allResults: TradeResult[] = [];
    let processedDays = 0;

    for (let i = 0; i < businessDays.length; i++) {
      const date = businessDays[i];
      try {
        const candles = await client.fetchOHLCV(pmlId, date, date);
        if (candles.length < 30) {
          logger.warn(`Skipping ${date}: only ${candles.length} candles`);
          continue;
        }

        // Build prev day context
        const prevDay = i > 0
          ? await this.buildPrevDayContext(pmlId, businessDays[i - 1], client)
          : null;

        // Index candles by minute offset from 9:15
        const candleByMinute = this.indexCandlesByMinute(candles);

        // Get exit candle (fixed at 15:14)
        const exitCandle = candleByMinute.get(FIXED_EXIT_MINUTES);
        if (!exitCandle) {
          logger.warn(`Skipping ${date}: no candle at exit time ${FIXED_EXIT_TIME}`);
          continue;
        }
        const exitPrice = exitCandle.close;

        // For each entry time, get model prediction and record trades
        for (const entryTime of entryTimes) {
          const entryMinutes = this.timeToMinutes(entryTime) - this.timeToMinutes("09:15");
          const windowSize = Math.floor(entryMinutes / STEP) * STEP;

          if (windowSize < STEP) continue;

          // Check if we have enough candles for this window
          if (candles.length < windowSize) continue;

          // Check if horizon model exists (via prediction engine)
          const model = predictionEngine.loadModel(symbol, version, modelType, windowSize);
          if (!model) continue;

          // Get entry price
          const entryCandle = candleByMinute.get(entryMinutes);
          if (!entryCandle) continue;
          const entryPrice = entryCandle.close;

          // Get prediction at this horizon
          const features = ctx.predictionEngine["featureEngineer"].compute(
            symbol, date, candles.slice(0, windowSize), prevDay, windowSize,
          );
          if (!features) continue;

          const featureArray = ctx.predictionEngine["featureEngineer"].toNumericArray(features);
          const predictedClose = model.predictClose(featureArray);

          // Skip if prediction is NaN
          if (!Number.isFinite(predictedClose)) continue;

          // Direction: if model predicts close > entry → buy now sell later (positive if price goes up)
          //           if model predicts close < entry → sell now buy later (positive if price goes down)
          const isLong = predictedClose >= entryPrice;

          const rawPnl = (exitPrice - entryPrice) / entryPrice * 100;
          const pnlPct = isLong ? rawPnl : -rawPnl;

          allResults.push({
            entryTime,
            entryPrice,
            exitPrice,
            pnlPct,
            date,
          });
        }

        processedDays++;
        if (processedDays % 5 === 0) {
          logger.info(`Processed ${processedDays}/${businessDays.length} days...`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Skipping ${date}: ${msg}`);
      }
    }

    logger.info(`Collected ${allResults.length} trade samples across ${processedDays} days`);

    if (allResults.length === 0) {
      throw new Error("No valid trade results — check if models exist and data is available");
    }

    // Aggregate into entry-time strategy stats (exit is always 15:14)
    const strategies = this.computeStrategyStats(allResults, processedDays);

    // Sort by composite score
    strategies.sort((a, b) => b.score - a.score);

    // Take top 20
    const top = strategies.slice(0, 20);

    // Print results
    logger.info("\n" + "═".repeat(85));
    logger.info(`TOP ENTRY TIMES for ${symbol} (${version}) — Exit fixed at ${FIXED_EXIT_TIME} — ${processedDays} days backtested`);
    logger.info("═".repeat(85));
    logger.info(
      "Rank  Entry   Exit     WinRate  AvgPnL   Sharpe  Consistency  MaxDD    Score",
    );
    logger.info("-".repeat(85));

    for (let i = 0; i < top.length; i++) {
      const s = top[i];
      logger.info(
        `${String(i + 1).padStart(3)}   ${s.entryTime}   ${s.exitTime}` +
        `    ${s.winRate.toFixed(0).padStart(3)}%     ${s.avgPnL >= 0 ? "+" : ""}${s.avgPnL.toFixed(2)}%` +
        `    ${s.sharpe.toFixed(2).padStart(5)}   ${s.consistency.toFixed(0).padStart(5)}%` +
        `       ${s.maxDrawdown.toFixed(2)}%   ${s.score.toFixed(2)}`,
      );
    }

    logger.info("═".repeat(85));

    if (top.length > 0) {
      const best = top[0];
      logger.info(`\n🏆 RECOMMENDATION: Entry at ${best.entryTime}, Exit at ${FIXED_EXIT_TIME}`);
      logger.info(`   Win rate: ${best.winRate.toFixed(1)}% | Avg PnL: ${best.avgPnL >= 0 ? "+" : ""}${best.avgPnL.toFixed(2)}% | Sharpe: ${best.sharpe.toFixed(2)} | Consistency: ${best.consistency.toFixed(0)}%`);
    }

    // Save best strategy to stock config in Firebase
    if (top.length > 0) {
      const best = top[0];
      await firebase.updateStock(symbol, {
        optimalEntry: best.entryTime,
        optimalExit: best.exitTime,
        optimalStats: {
          winRate: best.winRate,
          avgPnL: best.avgPnL,
          sharpe: best.sharpe,
          consistency: best.consistency,
          maxDrawdown: best.maxDrawdown,
          daysBacktested: processedDays,
          backtestDate: now().format("YYYY-MM-DD"),
        },
      });
      logger.info(`Updated stock ${symbol} with optimalEntry=${best.entryTime}, optimalExit=${best.exitTime}`);
    }

    // Save full report locally
    const report = {
      symbol,
      version,
      daysBacktested: processedDays,
      dateRange: { from: businessDays[0], to: businessDays[businessDays.length - 1] },
      generatedAt: now().format("YYYY-MM-DD HH:mm:ss"),
      topStrategies: top,
      totalStrategiesEvaluated: strategies.length,
    };

    const reportsDir = join(process.cwd(), "reports");
    if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, `optimal-${symbol}-${version}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");
    logger.info(`Full report saved to ${reportPath}`);
  }

  /**
   * Generate time strings at 5-min intervals between start and end.
   */
  private generateTimes(startH: number, startM: number, endH: number, endM: number): string[] {
    const times: string[] = [];
    let h = startH;
    let m = startM;
    const endMinutes = endH * 60 + endM;

    while (h * 60 + m <= endMinutes) {
      times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      m += STEP;
      if (m >= 60) {
        h += Math.floor(m / 60);
        m = m % 60;
      }
    }
    return times;
  }

  /**
   * Convert "HH:mm" to total minutes since midnight.
   */
  private timeToMinutes(time: string): number {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
  }

  /**
   * Index candles by their minute offset from 9:15.
   */
  private indexCandlesByMinute(candles: OHLCV[]): Map<number, OHLCV> {
    const map = new Map<number, OHLCV>();
    for (const c of candles) {
      const timePart = c.timestamp.split(" ")[1];
      if (!timePart) continue;
      const [h, m] = timePart.split(":").map(Number);
      const offset = (h * 60 + m) - (MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MIN);
      if (offset >= 0) {
        map.set(offset, c);
      }
    }
    return map;
  }

  /**
   * Compute strategy stats for each entry time (exit is always fixed at 15:14).
   */
  private computeStrategyStats(results: TradeResult[], _totalDays: number): StrategyStats[] {
    // Group by entryTime only (exit is fixed)
    const groups = new Map<string, TradeResult[]>();
    for (const r of results) {
      const arr = groups.get(r.entryTime) || [];
      arr.push(r);
      groups.set(r.entryTime, arr);
    }

    const stats: StrategyStats[] = [];

    for (const [entryTime, trades] of groups) {
      const exitTime = FIXED_EXIT_TIME;
      const n = trades.length;
      if (n < 5) continue; // Need at least 5 trades for meaningful stats

      const pnls = trades.map((t) => t.pnlPct);
      const wins = pnls.filter((p) => p > 0).length;
      const winRate = (wins / n) * 100;
      const avgPnL = pnls.reduce((s, v) => s + v, 0) / n;
      const maxDrawdown = Math.min(...pnls);

      // Sharpe ratio (annualized is meaningless for intraday, use raw mean/std)
      const mean = avgPnL;
      const variance = pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
      const std = Math.sqrt(variance);
      const sharpe = std > 0 ? mean / std : 0;

      // Consistency: % of days that were profitable
      const profitableDays = pnls.filter((p) => p > 0).length;
      const consistency = (profitableDays / n) * 100;

      // Composite score: winRate * consistency * sharpe (normalized)
      const score = (winRate / 100) * (consistency / 100) * Math.max(sharpe, 0) * 100;

      stats.push({
        entryTime,
        exitTime,
        trades: n,
        wins,
        winRate,
        avgPnL,
        sharpe,
        maxDrawdown,
        consistency,
        score,
      });
    }

    return stats;
  }

  /**
   * Build previous day context from candles.
   */
  private async buildPrevDayContext(
    pmlId: string,
    prevDate: string,
    client: { fetchOHLCV: (id: string, from: string, to: string) => Promise<OHLCV[]> },
  ): Promise<PreviousDayContext | null> {
    try {
      const candles = await client.fetchOHLCV(pmlId, prevDate, prevDate);
      if (candles.length === 0) return null;

      return {
        close: candles[candles.length - 1].close,
        high: Math.max(...candles.map((c) => c.high)),
        low: Math.min(...candles.map((c) => c.low)),
        averageMinVolume: candles.slice(0, 105).reduce((s, c) => s + c.volume, 0),
        close2: null,
        high2: null,
        low2: null,
        close3: null,
        high3: null,
        low3: null,
      };
    } catch {
      return null;
    }
  }
}
