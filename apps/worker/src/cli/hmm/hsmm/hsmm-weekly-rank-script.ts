import "../../../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import BaseScript from "../../base-script.ts";
import { GaussianParams } from "../types/gaussian-params.ts";
import { OHLCV } from "../../../types/market-data/ohlcv.ts";
import { forwardLogAlpha } from "../forward-backward.ts";
import { logSumExp } from "../utils/math.ts";
import { computeLogReturns } from "../utils/returns.ts";
import { trainHSMM } from "./baum-welch.ts";
import { viterbiHSMM } from "./decode.ts";
import { buildExpandedA, buildExpandedEmissions, buildExpandedPi, expandedIndex, remainingDurationOf } from "./expand.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "..", "..", "..", "..", "data");

const N = 3;
const D = 20;
const FOLDS = 5;
const MIN_OBSERVATIONS = 1000;
const STAGE2_CANDIDATE_LIMIT = 100;
const ROUND_TRIP_COST = 0.002; // 0.2% round trip, approximating NSE delivery costs
const uniformPi = Array(N).fill(1 / N);

function initParams(obs: number[]) {
  const mean = obs.reduce((sum, x) => sum + x, 0) / obs.length;
  const variance = obs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / obs.length;
  const std = Math.sqrt(variance);

  const A = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 0 : 1 / (N - 1))));
  const pi = Array(N).fill(1 / N);
  const durations = Array.from({ length: N }, () => Array(D).fill(1 / D));
  const emissionParams: GaussianParams[] = [
    { mean: mean - std * 0.5, variance: variance * 2 }, // crash / high-vol
    { mean, variance: variance * 0.3 }, // calm
    { mean: mean + std * 0.5, variance }, // trending up
  ];
  return { A, pi, durations, emissionParams };
}

function segmentLengths(moods: number[]): { length: number; mood: number }[] {
  const segments: { length: number; mood: number }[] = [];
  let start = 0;
  for (let t = 1; t <= moods.length; t++) {
    if (t === moods.length || moods[t] !== moods[start]) {
      segments.push({ length: t - start, mood: moods[start] });
      start = t;
    }
  }
  return segments;
}

interface Stage1Result {
  symbol: string;
  observations: number[];
  combinedScore: number;
}

interface ModelParams {
  A: number[][];
  pi: number[];
  durations: number[][];
  emissionParams: GaussianParams[];
}

interface Stage2Result {
  symbol: string;
  combinedScore: number;
  regimeStability: number;
  testDays: number;
  numTrades: number;
  pctTimeInMarket: number;
  strategyTotalReturn: number;
  buyHoldTotalReturn: number;
  strategySharpe: number;
  maxDrawdown: number;
  winRate: number;
  modelParams: ModelParams;
}

class HsmmWeeklyRankScript extends BaseScript {
  private candidateCount = 0;
  private stage1Count = 0;
  private stage2Count = 0;

  get scriptName(): string {
    return "hsmm-weekly-rank";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      "Candidates": this.candidateCount,
      "Stage 1 survivors": this.stage1Count,
      "Stage 2 survivors": this.stage2Count,
    };
  }

  protected async run(): Promise<void> {
    const candidates = await this.getCandidates();
    this.candidateCount = candidates.length;
    this.log.info(`${candidates.length} candidates for stage 1 screening`);

    const survivors: Stage1Result[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const symbol = candidates[i];
      try {
        const result = this.runStage1(symbol);
        if (result) survivors.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`${symbol} — stage 1 failed: ${msg}`);
      }
      if ((i + 1) % 25 === 0) this.log.info(`Stage 1 progress: ${i + 1}/${candidates.length}`);
    }

    survivors.sort((a, b) => b.combinedScore - a.combinedScore);
    this.stage1Count = survivors.length;

    this.log.info(`Stage 1 complete — ${survivors.length}/${candidates.length} survived`);
    for (const s of survivors.slice(0, 10)) {
      this.log.info(`  ${s.symbol}: combinedScore=${s.combinedScore.toFixed(3)}`);
    }

    const stage2Candidates = survivors.slice(0, STAGE2_CANDIDATE_LIMIT);
    const stage2Survivors: Stage2Result[] = [];
    for (let i = 0; i < stage2Candidates.length; i++) {
      const candidate = stage2Candidates[i];
      try {
        const result = this.runStage2(candidate);
        if (result) stage2Survivors.push(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`${candidate.symbol} — stage 2 failed: ${msg}`);
      }
      if ((i + 1) % 10 === 0) this.log.info(`Stage 2 progress: ${i + 1}/${stage2Candidates.length}`);
    }

    stage2Survivors.sort((a, b) => b.strategySharpe - a.strategySharpe);
    this.stage2Count = stage2Survivors.length;

    this.log.info(`Stage 2 complete — ${stage2Survivors.length}/${stage2Candidates.length} survived`);
    for (const s of stage2Survivors.slice(0, 10)) {
      this.log.info(`  ${s.symbol}: sharpe=${s.strategySharpe.toFixed(2)}, return=${(s.strategyTotalReturn * 100).toFixed(1)}%, stability=${(s.regimeStability * 100).toFixed(1)}%, trades=${s.numTrades}`);
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

  /**
   * Cheap single 80/20 fit + sanity filters, ported from screen-stocks.ts but
   * reading the production flat data path and using a stricter observation floor.
   */
  private runStage1(symbol: string): Stage1Result | null {
    const path = resolve(DATA_DIR, "daily-ohlcv", `${symbol}.json`);
    if (!existsSync(path)) return null;

    const ohlcv = JSON.parse(readFileSync(path, "utf-8")) as OHLCV[];
    const closes = ohlcv.map((c) => c.close);
    const observations = computeLogReturns(closes);
    if (observations.length < MIN_OBSERVATIONS) return null;

    const trainSize = Math.floor(observations.length * 0.8);
    const trainObs = observations.slice(0, trainSize);
    const testObs = observations.slice(trainSize);

    const init = initParams(trainObs);
    const result = trainHSMM(trainObs, init.A, init.pi, init.durations, init.emissionParams, 30);

    const finalLogLikelihood = result.logLikelihoods[result.logLikelihoods.length - 1];
    if (!isFinite(finalLogLikelihood)) return null;

    const expandedA = buildExpandedA(result.A, result.durations);
    const expandedPi = buildExpandedPi(uniformPi, result.durations);
    const expandedEmissions = buildExpandedEmissions(result.emissionParams, D);

    const logAlpha = forwardLogAlpha(testObs, expandedA, expandedPi, expandedEmissions);
    const testDecoded = viterbiHSMM(testObs, result.A, uniformPi, result.durations, result.emissionParams);

    const T = testObs.length;
    const predicted: number[] = Array(T);
    for (let t = 0; t < T; t++) {
      const logNorm = logSumExp(logAlpha[t]);
      let expected = 0;
      for (let state = 0; state < logAlpha[t].length; state++) {
        expected += remainingDurationOf(state, D) * Math.exp(logAlpha[t][state] - logNorm);
      }
      predicted[t] = expected;
    }

    const actual: number[] = Array(T);
    for (let t = 0; t < T; t++) {
      let j = t;
      while (j < T - 1 && testDecoded.moods[j + 1] === testDecoded.moods[t]) j++;
      actual[t] = j - t + 1;
    }

    let nSegStarts = 0;
    let segMaeSum = 0;
    for (let t = 0; t < T; t++) {
      if (t === 0 || testDecoded.moods[t] !== testDecoded.moods[t - 1]) {
        segMaeSum += Math.abs(predicted[t] - actual[t]);
        nSegStarts++;
      }
    }
    const maeSegStarts = segMaeSum / nSegStarts;

    const trainDecoded = viterbiHSMM(trainObs, result.A, result.pi, result.durations, result.emissionParams);
    const segments = segmentLengths(trainDecoded.moods);
    const avgSegmentLengthAll = segments.reduce((sum, s) => sum + s.length, 0) / segments.length;

    const order = [0, 1, 2].sort((a, b) => result.emissionParams[a].mean - result.emissionParams[b].mean);
    const [crashIdx, calmIdx, upIdx] = order;
    const crash = result.emissionParams[crashIdx];
    const calm = result.emissionParams[calmIdx];
    const up = result.emissionParams[upIdx];

    const upSegments = segments.filter((s) => s.mood === upIdx);
    const avgUpSegmentLength = upSegments.length > 0
      ? upSegments.reduce((sum, s) => sum + s.length, 0) / upSegments.length
      : 0;

    const avgStd = (Math.sqrt(crash.variance) + Math.sqrt(calm.variance) + Math.sqrt(up.variance)) / 3;
    const regimeSeparation = (up.mean - crash.mean) / avgStd;
    const relativeMae = maeSegStarts / avgSegmentLengthAll;
    const combinedScore = regimeSeparation / (relativeMae + 1e-6);

    if (avgUpSegmentLength < 4 || up.mean < 0.001 || up.mean > 0.02 || up.variance <= 0.0001 || relativeMae > 1.0) {
      return null;
    }

    return { symbol, observations, combinedScore };
  }

  /**
   * 5-fold expanding-window rolling backtest (as in backtest.ts) merged with the
   * fold-vs-previous-fold decode agreement (as in walkforward-top10.ts) for
   * regimeStability. The last fold's fitted params (trained on ~96% of history)
   * are captured as modelParams for the daily signal script.
   */
  private runStage2(stage1: Stage1Result): Stage2Result | null {
    const { symbol, observations, combinedScore } = stage1;

    const initialTrainSize = Math.floor(observations.length * 0.8);
    const foldSize = Math.floor((observations.length - initialTrainSize) / FOLDS);

    const signal: number[] = [];
    const testReturns: number[] = [];
    const foldStabilities: number[] = [];
    let prevTrainDecode: { size: number; moods: number[] } | null = null;
    let lastFoldModel: ModelParams | null = null;

    for (let fold = 0; fold < FOLDS; fold++) {
      const trainSize = initialTrainSize + fold * foldSize;
      const testEnd = fold === FOLDS - 1 ? observations.length : trainSize + foldSize;

      const trainObs = observations.slice(0, trainSize);
      const testObs = observations.slice(trainSize, testEnd);

      const init = initParams(trainObs);
      const result = trainHSMM(trainObs, init.A, init.pi, init.durations, init.emissionParams, 30);

      const expandedA = buildExpandedA(result.A, result.durations);
      const expandedPi = buildExpandedPi(uniformPi, result.durations);
      const expandedEmissions = buildExpandedEmissions(result.emissionParams, D);
      const logAlpha = forwardLogAlpha(testObs, expandedA, expandedPi, expandedEmissions);

      const upIdx = [0, 1, 2].sort((a, b) => result.emissionParams[b].mean - result.emissionParams[a].mean)[0];

      for (let t = 0; t < testObs.length; t++) {
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
        signal.push(mostLikely === upIdx ? 1 : 0);
        testReturns.push(testObs[t]);
      }

      if (prevTrainDecode) {
        const overlapDecoded = viterbiHSMM(trainObs.slice(0, prevTrainDecode.size), result.A, result.pi, result.durations, result.emissionParams);
        let agree = 0;
        for (let t = 0; t < prevTrainDecode.size; t++) {
          if (overlapDecoded.moods[t] === prevTrainDecode.moods[t]) agree++;
        }
        foldStabilities.push(agree / prevTrainDecode.size);
      }

      const fullTrainDecoded = viterbiHSMM(trainObs, result.A, result.pi, result.durations, result.emissionParams);
      prevTrainDecode = { size: trainSize, moods: fullTrainDecoded.moods };

      if (fold === FOLDS - 1) {
        lastFoldModel = { A: result.A, pi: result.pi, durations: result.durations, emissionParams: result.emissionParams };
      }
    }

    // strategy log-returns: in market when signal=1, minus half the round-trip cost on each transition
    const strategyReturns: number[] = Array(signal.length);
    for (let t = 0; t < signal.length; t++) {
      let r = signal[t] ? testReturns[t] : 0;
      const transitioned = t === 0 ? signal[t] === 1 : signal[t] !== signal[t - 1];
      if (transitioned) r -= ROUND_TRIP_COST / 2;
      strategyReturns[t] = r;
    }

    const T = strategyReturns.length;
    const sumStrategy = strategyReturns.reduce((s, x) => s + x, 0);
    const sumBuyHold = testReturns.reduce((s, x) => s + x, 0);
    const strategyTotalReturn = Math.exp(sumStrategy) - 1;
    const buyHoldTotalReturn = Math.exp(sumBuyHold) - 1;

    const meanStrategy = sumStrategy / T;
    const varStrategy = strategyReturns.reduce((s, x) => s + (x - meanStrategy) ** 2, 0) / T;
    const strategySharpe = (meanStrategy / Math.sqrt(varStrategy)) * Math.sqrt(252);

    let cum = 0;
    let runningMax = -Infinity;
    let maxDrawdown = 0;
    for (let t = 0; t < T; t++) {
      cum += strategyReturns[t];
      const equity = Math.exp(cum);
      runningMax = Math.max(runningMax, equity);
      maxDrawdown = Math.min(maxDrawdown, (equity - runningMax) / runningMax);
    }

    let numTrades = 0;
    let wins = 0;
    let inTrade = false;
    let inTradeReturn = 0;
    for (let t = 0; t < T; t++) {
      if (signal[t] === 1 && !inTrade) {
        inTrade = true;
        numTrades++;
        inTradeReturn = 0;
      }
      if (inTrade) inTradeReturn += strategyReturns[t];
      if (signal[t] === 0 && inTrade) {
        inTrade = false;
        if (inTradeReturn > 0) wins++;
      }
    }
    if (inTrade && inTradeReturn > 0) wins++;
    const winRate = numTrades > 0 ? wins / numTrades : 0;
    const pctTimeInMarket = signal.reduce((s, x) => s + x, 0) / T;

    const regimeStability = foldStabilities.reduce((s, x) => s + x, 0) / foldStabilities.length;

    if (numTrades < 10 || regimeStability < 0.85) return null;

    return {
      symbol,
      combinedScore,
      regimeStability,
      testDays: T,
      numTrades,
      pctTimeInMarket,
      strategyTotalReturn,
      buyHoldTotalReturn,
      strategySharpe,
      maxDrawdown,
      winRate,
      modelParams: lastFoldModel!,
    };
  }
}

new HsmmWeeklyRankScript().start();
