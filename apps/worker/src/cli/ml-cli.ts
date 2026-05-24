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
 * ML CLI — thin dispatcher that queues requests for all enabled stocks.
 * Each command pushes entries to request_queue, handled by request-orchestration-script.
 *
 * Usage: tsx src/cli/ml-cli.ts <command>
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
ML CLI — Queue requests for all enabled stocks

Usage: tsx src/cli/ml-cli.ts <command>

Commands:
  train       Queue training for all enabled stocks
  predict     Queue predictions for today (all enabled stocks with models)
  evaluate    Queue evaluation for today (all enabled stocks)
  `);
}

main().then(() => {
  // Firebase keeps the connection open — force exit for one-shot commands
  process.exit(0);
}).catch((e) => {
  logger.error(`Fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
