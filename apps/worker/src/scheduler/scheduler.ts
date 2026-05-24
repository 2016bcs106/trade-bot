import { createTask, ScheduledTask } from "node-cron";
import { now, nowFormatted } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";

const logger = createLogger("scheduler");

/**
 * Job scheduler for automated trading platform operations.
 *
 * All times are IST (UTC+05:30). Market hours: 9:15 AM - 3:30 PM, Mon-Fri.
 *
 * Default schedule:
 * - 10:05 AM IST: Generate predictions (after first 45 min of data)
 * - 3:45 PM IST: Evaluate predictions (after market close)
 * - 4:00 PM IST: Shadow model retraining
 * - Saturday 2:00 AM: Weekly optimization review
 */
export default class Scheduler {
  private jobs: Map<string, ScheduledTask> = new Map();
  private handlers: Map<string, () => Promise<void>> = new Map();

  /**
   * Register a job handler that will be called on the cron schedule.
   */
  register(name: string, cronExpression: string, handler: () => Promise<void>): void {
    this.handlers.set(name, handler);

    const task = createTask(cronExpression, async () => {
      const ts = nowFormatted();
      logger.info(`Job [${name}] triggered at ${ts}`);

      try {
        await handler();
        logger.info(`Job [${name}] completed successfully`);
      } catch (error) {
        logger.error(`Job [${name}] failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, {
      timezone: "Asia/Kolkata",
      name,
    });

    this.jobs.set(name, task);
    logger.info(`Registered job: ${name} (${cronExpression})`);
  }

  /**
   * Start all registered jobs.
   */
  start(): void {
    for (const [name, task] of this.jobs) {
      task.start();
      logger.info(`Started job: ${name}`);
    }
    logger.info(`Scheduler running with ${this.jobs.size} jobs`);
  }

  /**
   * Stop all registered jobs.
   */
  stop(): void {
    for (const [name, task] of this.jobs) {
      task.stop();
      logger.info(`Stopped job: ${name}`);
    }
  }

  /**
   * Manually trigger a job by name (for CLI usage).
   */
  async trigger(name: string): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) {
      throw new Error(`Unknown job: ${name}. Available: ${[...this.handlers.keys()].join(", ")}`);
    }

    logger.info(`Manually triggering job: ${name}`);
    await handler();
  }

  /**
   * Check if current time is during market hours (9:15 AM - 3:30 PM IST, Mon-Fri).
   */
  static isMarketHours(): boolean {
    const current = now();
    const day = current.day(); // 0=Sun, 6=Sat

    // Weekdays only
    if (day === 0 || day === 6) return false;

    const hour = current.hour();
    const minute = current.minute();
    const timeInMinutes = hour * 60 + minute;

    const marketOpen = 9 * 60 + 15;  // 9:15 AM
    const marketClose = 15 * 60 + 30; // 3:30 PM

    return timeInMinutes >= marketOpen && timeInMinutes <= marketClose;
  }

  /**
   * Check if today is a trading day (Mon-Fri, not a holiday).
   * Note: Holiday calendar not implemented yet — only checks weekdays.
   */
  static isTradingDay(): boolean {
    const current = now();
    const day = current.day();
    return day >= 1 && day <= 5;
  }

  /**
   * Get list of registered job names.
   */
  listJobs(): string[] {
    return [...this.jobs.keys()];
  }
}

/**
 * Create a scheduler with default trading jobs pre-registered.
 * Pass handlers for each job type.
 */
export function createDefaultScheduler(handlers: {
  predict?: () => Promise<void>;
  evaluate?: () => Promise<void>;
  retrain?: () => Promise<void>;
  optimize?: () => Promise<void>;
}): Scheduler {
  const scheduler = new Scheduler();

  if (handlers.predict) {
    // 10:05 AM IST Mon-Fri — after first 45 min candle data available
    scheduler.register("predict", "5 10 * * 1-5", handlers.predict);
  }

  if (handlers.evaluate) {
    // 3:45 PM IST Mon-Fri — after market close
    scheduler.register("evaluate", "45 15 * * 1-5", handlers.evaluate);
  }

  if (handlers.retrain) {
    // 4:00 PM IST Mon-Fri — shadow model retraining
    scheduler.register("retrain", "0 16 * * 1-5", handlers.retrain);
  }

  if (handlers.optimize) {
    // Saturday 2:00 AM IST — weekly optimization review
    scheduler.register("optimize", "0 2 * * 6", handlers.optimize);
  }

  return scheduler;
}
