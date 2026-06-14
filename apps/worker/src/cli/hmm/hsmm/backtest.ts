import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { appendFileSync, readFileSync, writeFileSync } from "fs";
import { GaussianParams } from "../types/gaussian-params.ts";
import { OHLCV } from "../../../types/market-data/ohlcv.ts";
import { forwardLogAlpha } from "../forward-backward.ts";
import { logSumExp } from "../utils/math.ts";
import { computeLogReturns } from "../utils/returns.ts";
import { trainHSMM } from "./baum-welch.ts";
import { buildExpandedA, buildExpandedEmissions, buildExpandedPi, expandedIndex } from "./expand.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "..", "..", "..", "..", "data");

const SYMBOLS = ["ADANIENT", "IRFC", "VEDL", "WELSPUNLIV", "INFOBEAN", "SWSOLAR"];
const N = 3;
const D = 20;
const FOLDS = 5;
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

const CSV_PATH = resolve(DATA_DIR, "hsmm-backtest-results.csv");
writeFileSync(CSV_PATH, "symbol,testDays,numTrades,pctTimeInMarket,strategyTotalReturn,buyHoldTotalReturn,strategySharpe,maxDrawdown,winRate\n");

for (const symbol of SYMBOLS) {
  const ohlcv = JSON.parse(readFileSync(resolve(DATA_DIR, "daily-ohlcv", "daily-ohlcv", `${symbol}.json`), "utf-8")) as OHLCV[];
  const closes = ohlcv.map((c) => c.close);
  const observations = computeLogReturns(closes);

  const initialTrainSize = Math.floor(observations.length * 0.8);
  const foldSize = Math.floor((observations.length - initialTrainSize) / FOLDS);

  const signal: number[] = [];
  const testReturns: number[] = [];

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

  appendFileSync(CSV_PATH, [
    symbol, T, numTrades, pctTimeInMarket.toFixed(4),
    strategyTotalReturn.toFixed(4), buyHoldTotalReturn.toFixed(4),
    strategySharpe.toFixed(3), maxDrawdown.toFixed(4), winRate.toFixed(3),
  ].join(",") + "\n");

  console.log(`\n${symbol}: testDays=${T}, trades=${numTrades}, timeInMarket=${(pctTimeInMarket * 100).toFixed(1)}%`);
  console.log(`  strategy return=${(strategyTotalReturn * 100).toFixed(1)}%, buy&hold=${(buyHoldTotalReturn * 100).toFixed(1)}%`);
  console.log(`  Sharpe=${strategySharpe.toFixed(2)}, maxDrawdown=${(maxDrawdown * 100).toFixed(1)}%, winRate=${(winRate * 100).toFixed(1)}%`);
}
