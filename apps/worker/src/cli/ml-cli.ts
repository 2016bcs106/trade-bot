import "../config/env.ts";
import moment from "moment";
import createLogger from "../utils/logger.ts";
import TradingConfig from "../config/trading-config.ts";
import Scheduler, { createDefaultScheduler } from "../scheduler/scheduler.ts";
import { handleTrain } from "../commands/train.ts";
import { handlePredict } from "../commands/predict.ts";
import { handleEvaluate } from "../commands/evaluate.ts";
import { handleOptimize } from "../commands/optimize.ts";

const logger = createLogger("ml-cli");

const COMMANDS = ["train", "predict", "evaluate", "retrain", "optimize", "scheduler:start", "scheduler:list"] as const;
type Command = typeof COMMANDS[number];

/**
 * ML CLI — uses TradingConfig.parseArgs() for consistent --key=value arg parsing.
 *
 * Usage: tsx src/cli/ml-cli.ts <command> [--symbol=SYMBOL] [--all]
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0] as Command;

  if (!command || !COMMANDS.includes(command)) {
    printUsage();
    process.exit(1);
  }

  // Parse --key=value args using TradingConfig's parser
  const args = TradingConfig.parseArgs(argv.slice(1));
  const symbol = (args.symbol || args.s || "").toUpperCase() || null;
  const all = argv.includes("--all");

  const now = moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss");
  logger.info(`[${now}] Command: ${command}${symbol ? ` --symbol=${symbol}` : ""}${all ? " --all" : ""}`);

  switch (command) {
    case "train":
      return handleTrain(symbol, all);
    case "predict":
      return handlePredict(symbol, all);
    case "evaluate":
      return handleEvaluate(symbol, all);
    case "retrain":
      return handleTrain(symbol, all);
    case "optimize":
      return handleOptimize(symbol, all);
    case "scheduler:start":
      return startScheduler();
    case "scheduler:list":
      return listJobs();
  }
}

function startScheduler(): Promise<void> {
  const scheduler = createDefaultScheduler({
    predict: () => handlePredict(null, true),
    evaluate: () => handleEvaluate(null, true),
    retrain: () => handleTrain(null, true),
    optimize: () => handleOptimize(null, true),
  });

  scheduler.start();
  logger.info(`Scheduler running (${scheduler.listJobs().length} jobs). Market hours: ${Scheduler.isMarketHours() ? "YES" : "NO"}`);
  return new Promise(() => {});
}

function listJobs(): void {
  const scheduler = createDefaultScheduler({
    predict: async () => {},
    evaluate: async () => {},
    retrain: async () => {},
    optimize: async () => {},
  });
  logger.info(`Jobs: ${scheduler.listJobs().join(", ")}`);
}

function printUsage(): void {
  console.log(`
ML CLI — Quantitative Research Platform

Usage: tsx src/cli/ml-cli.ts <command> [--symbol=SYMBOL] [--all]

Commands:
  train             Train a new model
  predict           Generate prediction for today
  evaluate          Evaluate predictions against actuals
  retrain           Force shadow model retraining
  optimize          Run optimization review
  scheduler:start   Start the cron scheduler
  scheduler:list    List registered scheduler jobs

Options:
  --symbol=SYMBOL   Stock symbol (e.g., --symbol=RELIANCE)
  --all             Process all enabled stocks
  `);
}

main().catch((e) => {
  logger.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
