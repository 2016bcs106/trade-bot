import moment from "moment";
import createLogger from "../utils/logger.ts";
import Scheduler, { createDefaultScheduler } from "../scheduler/scheduler.ts";

const logger = createLogger("ml-cli");

/**
 * ML CLI — unified command-line interface for all ML operations.
 *
 * Usage:
 *   tsx src/cli/ml-cli.ts <command> [--symbol SYMBOL]
 *
 * Commands:
 *   train           — Train a new model for a symbol
 *   predict         — Generate prediction for today
 *   evaluate        — Evaluate today's predictions against actuals
 *   retrain         — Force shadow model retraining
 *   optimize        — Run optimization review (promote shadow if better)
 *   scheduler:start — Start the cron scheduler
 *   scheduler:list  — List registered scheduler jobs
 *
 * Options:
 *   --symbol, -s    Stock symbol (required for train, predict, evaluate, retrain)
 *   --all           Process all enabled stocks
 */

const COMMANDS = ["train", "predict", "evaluate", "retrain", "optimize", "scheduler:start", "scheduler:list"] as const;
type Command = typeof COMMANDS[number];

function parseArgs(): { command: Command; symbol: string | null; all: boolean } {
  const args = process.argv.slice(2);

  const command = args[0] as Command;
  if (!command || !COMMANDS.includes(command)) {
    printUsage();
    process.exit(1);
  }

  let symbol: string | null = null;
  let all = false;

  for (let i = 1; i < args.length; i++) {
    if ((args[i] === "--symbol" || args[i] === "-s") && args[i + 1]) {
      symbol = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === "--all") {
      all = true;
    }
  }

  return { command, symbol, all };
}

function printUsage(): void {
  console.log(`
ML CLI — Quantitative Research Platform

Usage: tsx src/cli/ml-cli.ts <command> [options]

Commands:
  train             Train a new model for a symbol
  predict           Generate prediction for today
  evaluate          Evaluate predictions against actual prices
  retrain           Force shadow model retraining
  optimize          Run optimization review
  scheduler:start   Start the cron scheduler
  scheduler:list    List registered scheduler jobs

Options:
  --symbol, -s      Stock symbol (e.g., RELIANCE)
  --all             Process all enabled stocks
  `);
}

async function main(): Promise<void> {
  const { command, symbol, all } = parseArgs();
  const now = moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss");

  logger.info(`[${now}] Executing command: ${command}${symbol ? ` for ${symbol}` : ""}${all ? " (all stocks)" : ""}`);

  switch (command) {
    case "train":
      await handleTrain(symbol, all);
      break;
    case "predict":
      await handlePredict(symbol, all);
      break;
    case "evaluate":
      await handleEvaluate(symbol, all);
      break;
    case "retrain":
      await handleRetrain(symbol, all);
      break;
    case "optimize":
      await handleOptimize(symbol, all);
      break;
    case "scheduler:start":
      await handleSchedulerStart();
      break;
    case "scheduler:list":
      handleSchedulerList();
      break;
  }
}

async function handleTrain(symbol: string | null, all: boolean): Promise<void> {
  if (!symbol && !all) {
    logger.error("Please specify --symbol or --all");
    process.exit(1);
  }
  // TODO: Integrate with ModelTrainer + FirebaseClient to fetch enabled stocks
  logger.info(`Training ${all ? "all enabled stocks" : symbol}...`);
  logger.info("TODO: Full integration with ModelTrainer pipeline");
}

async function handlePredict(symbol: string | null, all: boolean): Promise<void> {
  if (!symbol && !all) {
    logger.error("Please specify --symbol or --all");
    process.exit(1);
  }
  logger.info(`Generating predictions for ${all ? "all enabled stocks" : symbol}...`);
  logger.info("TODO: Full integration with PredictionEngine pipeline");
}

async function handleEvaluate(symbol: string | null, all: boolean): Promise<void> {
  if (!symbol && !all) {
    logger.error("Please specify --symbol or --all");
    process.exit(1);
  }
  logger.info(`Evaluating predictions for ${all ? "all enabled stocks" : symbol}...`);
  logger.info("TODO: Full integration with EvaluationEngine pipeline");
}

async function handleRetrain(symbol: string | null, all: boolean): Promise<void> {
  if (!symbol && !all) {
    logger.error("Please specify --symbol or --all");
    process.exit(1);
  }
  logger.info(`Retraining shadow model for ${all ? "all enabled stocks" : symbol}...`);
  logger.info("TODO: Full integration with shadow retraining pipeline");
}

async function handleOptimize(symbol: string | null, all: boolean): Promise<void> {
  logger.info(`Running optimization review for ${all || !symbol ? "all enabled stocks" : symbol}...`);
  logger.info("TODO: Full integration with model promotion logic");
}

async function handleSchedulerStart(): Promise<void> {
  logger.info("Starting scheduler...");

  const scheduler = createDefaultScheduler({
    predict: async () => {
      logger.info("Scheduler: running predict job");
      await handlePredict(null, true);
    },
    evaluate: async () => {
      logger.info("Scheduler: running evaluate job");
      await handleEvaluate(null, true);
    },
    retrain: async () => {
      logger.info("Scheduler: running retrain job");
      await handleRetrain(null, true);
    },
    optimize: async () => {
      logger.info("Scheduler: running optimize job");
      await handleOptimize(null, true);
    },
  });

  scheduler.start();
  logger.info(`Scheduler started. Market hours check: ${Scheduler.isMarketHours() ? "YES" : "NO"}`);

  // Keep process alive
  await new Promise(() => {});
}

function handleSchedulerList(): void {
  const scheduler = createDefaultScheduler({
    predict: async () => {},
    evaluate: async () => {},
    retrain: async () => {},
    optimize: async () => {},
  });

  const jobs = scheduler.listJobs();
  logger.info(`Registered jobs (${jobs.length}):`);
  for (const job of jobs) {
    logger.info(`  - ${job}`);
  }
}

main().catch((error) => {
  logger.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
