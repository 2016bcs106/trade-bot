import "../config/env.ts";
import { nowFormatted } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import { handleTrain } from "../commands/train.ts";
import { handlePredict } from "../commands/predict.ts";
import { handleEvaluate } from "../commands/evaluate.ts";

const logger = createLogger("ml-cli");

const COMMANDS = ["train", "predict", "evaluate"] as const;
type Command = typeof COMMANDS[number];

/**
 * ML CLI — thin dispatcher that delegates to command handlers.
 * All --key=value args are parsed by TradingConfig("ml") inside each handler.
 *
 * Usage: tsx src/cli/ml-cli.ts <command> [--symbol=SYMBOL] [--all] [--lookbackDays=90]
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0] as Command;

  if (!command || !COMMANDS.includes(command)) {
    printUsage();
    process.exit(1);
  }

  const now = nowFormatted();
  logger.info(`[${now}] Command: ${command} ${argv.slice(1).join(" ")}`.trim());

  switch (command) {
    case "train":
      return handleTrain();
    case "predict":
      return handlePredict();
    case "evaluate":
      return handleEvaluate();
  }
}

function printUsage(): void {
  console.log(`
ML CLI — Quantitative Research Platform

Usage: tsx src/cli/ml-cli.ts <command> [--symbol=SYMBOL] [--all] [--lookbackDays=N]

Commands:
  train             Train a new linear-regression model
  predict           Generate prediction for today
  evaluate          Evaluate predictions against actuals

Options:
  --symbol=SYMBOL   Stock symbol (e.g., --symbol=RELIANCE)
  --all             Process all enabled stocks
  --lookbackDays=N  Training lookback in days (default: 90)
  `);
}

main().then(() => {
  // Firebase keeps the connection open — force exit for one-shot commands
  process.exit(0);
}).catch((e) => {
  logger.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
