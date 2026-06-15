import "../../../config/env.ts";
import { nowISO } from "../../../utils/time.ts";
import BaseScript from "../../base-script.ts";
import { Stage1Result, Stage2Result } from "./rank-stages.ts";
import RankWorkerPool from "./worker-pool.ts";

const STRATEGY_KEY = "HSMM_REGIME_FLIP";
const STAGE2_CANDIDATE_LIMIT = 100;
const RECOMMEND_COUNT = 50;
// Conservative default — the EC2 host has ~916MB RAM and is already swapping.
const POOL_SIZE = Number(process.env.HSMM_WORKER_POOL_SIZE) || 2;

class HsmmWeeklyRankScript extends BaseScript {
  private candidateCount = 0;
  private stage1Count = 0;
  private stage2Count = 0;
  private recommendedCount = 0;

  get scriptName(): string {
    return "hsmm-weekly-rank";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      "Candidates": this.candidateCount,
      "Stage 1 survivors": this.stage1Count,
      "Stage 2 survivors": this.stage2Count,
      "Recommended": this.recommendedCount,
    };
  }

  protected async run(): Promise<void> {
    const candidates = await this.getCandidates();
    this.candidateCount = candidates.length;
    this.log.info(`${candidates.length} candidates for stage 1 screening`);

    const survivors: Stage1Result[] = [];
    {
      const pool = new RankWorkerPool(POOL_SIZE);
      let completed = 0;
      await Promise.all(candidates.map(async (symbol) => {
        try {
          const result = await pool.run<Stage1Result | null>({ type: "stage1", symbol });
          if (result) survivors.push(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.error(`${symbol} — stage 1 failed: ${msg}`);
        } finally {
          completed++;
          if (completed % 25 === 0) this.log.info(`Stage 1 progress: ${completed}/${candidates.length}`);
        }
      }));
      await pool.destroy();
    }

    survivors.sort((a, b) => b.combinedScore - a.combinedScore);
    this.stage1Count = survivors.length;

    this.log.info(`Stage 1 complete — ${survivors.length}/${candidates.length} survived`);
    for (const s of survivors.slice(0, 10)) {
      this.log.info(`  ${s.symbol}: combinedScore=${s.combinedScore.toFixed(3)}`);
    }

    const stage2Candidates = survivors.slice(0, STAGE2_CANDIDATE_LIMIT);
    const stage2Survivors: Stage2Result[] = [];
    {
      const pool = new RankWorkerPool(POOL_SIZE);
      let completed = 0;
      await Promise.all(stage2Candidates.map(async (candidate) => {
        try {
          const result = await pool.run<Stage2Result | null>({ type: "stage2", stage1: candidate });
          if (result) stage2Survivors.push(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.error(`${candidate.symbol} — stage 2 failed: ${msg}`);
        } finally {
          completed++;
          if (completed % 10 === 0) this.log.info(`Stage 2 progress: ${completed}/${stage2Candidates.length}`);
        }
      }));
      await pool.destroy();
    }

    stage2Survivors.sort((a, b) => b.strategySharpe - a.strategySharpe);
    this.stage2Count = stage2Survivors.length;

    this.log.info(`Stage 2 complete — ${stage2Survivors.length}/${stage2Candidates.length} survived`);
    for (const s of stage2Survivors.slice(0, 10)) {
      this.log.info(`  ${s.symbol}: sharpe=${s.strategySharpe.toFixed(2)}, return=${(s.strategyTotalReturn * 100).toFixed(1)}%, stability=${(s.regimeStability * 100).toFixed(1)}%, trades=${s.numTrades}`);
    }

    const fittedAt = nowISO();
    this.recommendedCount = Math.min(stage2Survivors.length, RECOMMEND_COUNT);

    for (let i = 0; i < stage2Survivors.length; i++) {
      const s = stage2Survivors[i];
      const isRecommended = i < RECOMMEND_COUNT;
      await this.firebase.setRecommendationData(s.symbol, STRATEGY_KEY, {
        recommended: isRecommended,
        rank: isRecommended ? i + 1 : null,
        combinedScore: s.combinedScore,
        regimeStability: s.regimeStability,
        testDays: s.testDays,
        numTrades: s.numTrades,
        pctTimeInMarket: s.pctTimeInMarket,
        strategyTotalReturn: s.strategyTotalReturn,
        buyHoldTotalReturn: s.buyHoldTotalReturn,
        strategySharpe: s.strategySharpe,
        maxDrawdown: s.maxDrawdown,
        winRate: s.winRate,
        modelParams: s.modelParams,
        fittedAt,
      });
    }

    // any stock previously recommended but not re-evaluated this run loses its flag
    const evaluated = new Set(stage2Survivors.map((s) => s.symbol));
    const allStocks = await this.firebase.getAllStocks();
    for (const [symbol, stock] of Object.entries(allStocks)) {
      const existing = stock.recommendationData?.[STRATEGY_KEY];
      if (existing?.recommended === true && !evaluated.has(symbol)) {
        await this.firebase.setRecommendationData(symbol, STRATEGY_KEY, { ...existing, recommended: false, rank: null });
      }
    }

    this.log.info(`Recommended ${this.recommendedCount} stocks (rank 1-${RECOMMEND_COUNT}):`);
    for (let i = 0; i < this.recommendedCount; i++) {
      const s = stage2Survivors[i];
      this.log.info(`  #${i + 1} ${s.symbol}: sharpe=${s.strategySharpe.toFixed(2)}, return=${(s.strategyTotalReturn * 100).toFixed(1)}%, maxDD=${(s.maxDrawdown * 100).toFixed(1)}%, winRate=${(s.winRate * 100).toFixed(1)}%`);
    }
  }

  private async getCandidates(): Promise<string[]> {
    const symbolsArg = process.argv.find((a) => a.startsWith("--symbols="));
    if (symbolsArg) {
      return symbolsArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean);
    }
    const stocks = await this.firebase.getAllStocks();
    return Object.values(stocks).filter((s) => s.isTopStock).map((s) => s.symbol);
  }
}

new HsmmWeeklyRankScript().start();
