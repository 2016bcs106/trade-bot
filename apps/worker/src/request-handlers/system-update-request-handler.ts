import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { now } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";

const logger = createLogger("handler:system-update");

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..", "..");
const WORKER_DIR = resolve(PROJECT_ROOT, "apps", "worker");
const CRON_CONFIG_PATH = resolve(WORKER_DIR, "cron-config.json");

/**
 * Cron config entry — defines a script to run via crontab.
 */
interface CronEntry {
  /** Unique name for the lock file (e.g., "request-handler") */
  name: string;
  /** Cron schedule expression (e.g., "* * * * *" for always-running) */
  schedule: string;
  /** The command to run inside the worker dir (e.g., "src/cli/request-orchestration-script.ts") */
  command: string;
}

/**
 * Handles "system_update" requests — performs a full deployment cycle:
 *
 * 1. Git add + stash (avoid conflicts)
 * 2. Git pull --rebase (get latest code)
 * 3. Deploy frontend (always)
 * 4. Remove + reinstall crons (always)
 * 5. Wait until XX:XX:55 to minimize downtime (cron fires at :00)
 * 6. Kill all running trade-bot processes
 *
 * IMPORTANT: This handler returns normally so the orchestrator can
 * remove the request from the queue before the kill step terminates everything.
 *
 * No payload required.
 */
export class SystemUpdateRequestHandler implements RequestHandler {
  async handle(_request: QueuedRequest, _ctx: ServiceContext): Promise<void> {
    logger.info("=== SYSTEM UPDATE STARTED ===");

    // ─── Step 1: Git stash ───────────────────────────────────────────
    logger.info("Step 1: Stashing local changes...");
    this.exec("git add -A", PROJECT_ROOT);
    this.exec("git stash", PROJECT_ROOT);

    // ─── Step 2: Git pull --rebase ───────────────────────────────────
    logger.info("Step 2: Pulling latest code...");
    this.exec("git pull --rebase origin master", PROJECT_ROOT);

    // ─── Step 3: Deploy frontend ─────────────────────────────────────
    logger.info("Step 3: Deploying frontend...");
    try {
      this.exec("pnpm --filter frontend deploy", PROJECT_ROOT);
      logger.info("  ✓ Frontend deployed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`  ⚠ Frontend deploy failed (non-fatal): ${msg}`);
    }

    // ─── Step 5: Remove all trade-bot crons ──────────────────────────
    logger.info("Step 5: Removing existing trade-bot crons...");
    this.removeTradeBotCrons();

    // ─── Step 6: Install new crons from config ───────────────────────
    logger.info("Step 6: Installing new crons from cron-config.json...");
    this.installCronsFromConfig();

    // ─── Step 7: Remove this request from Firebase before killing ────
    if (_request._key) {
      logger.info("Step 7: Removing request from queue...");
      await _ctx.firebase.removeRequest(_request._key);
    }

    // ─── Step 8: Wait until XX:XX:55 then kill processes ─────────────
    // Cron fires at :00, so killing at :55 gives ~5 seconds of downtime
    await this.waitUntilSecond55();

    logger.info("Step 8: Killing all running trade-bot processes...");
    logger.info("=== SYSTEM UPDATE COMPLETE — restarting via cron ===");

    // Small delay to ensure logs flush
    await new Promise((r) => setTimeout(r, 500));

    // Kill all trade-bot processes (including self)
    try {
      execSync(
        `ps aux | grep "[t]rade-bot" | awk '{print $2}' | xargs kill 2>/dev/null || true`,
        { stdio: "ignore" },
      );
    } catch {
      // Expected to fail when killing self
    }

    // If somehow we survive, exit
    process.exit(0);
  }

  /**
   * Wait until the current minute reaches second 55.
   * This minimizes downtime since cron will restart processes at the next :00.
   * If already past :55, proceeds immediately.
   */
  private async waitUntilSecond55(): Promise<void> {
    const currentSecond = now().second();

    if (currentSecond >= 55) {
      logger.info(`  Current second: ${currentSecond} — proceeding immediately`);
      return;
    }

    const waitMs = (55 - currentSecond) * 1000;
    logger.info(`  Current second: ${currentSecond} — waiting ${55 - currentSecond}s until :55...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  private exec(command: string, cwd: string): string {
    logger.info(`  $ ${command}`);
    const nodeDir = this.detectNodeDir();
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      timeout: 120_000, // 2 minute timeout
      env: { ...process.env, PATH: `${nodeDir}:${process.env.PATH}` },
    });
    if (output.trim()) {
      logger.info(`  → ${output.trim().split("\n").slice(0, 5).join("\n    ")}`);
    }
    return output;
  }

  private removeTradeBotCrons(): void {
    try {
      const currentCrontab = execSync("crontab -l 2>/dev/null || true", { encoding: "utf-8" });
      const lines = currentCrontab.split("\n");
      const filtered = lines.filter((line) => !line.includes("trade-bot"));
      const newCrontab = filtered.join("\n").trim() + "\n";
      execSync(`echo '${newCrontab.replace(/'/g, "'\\''")}' | crontab -`, { encoding: "utf-8" });
      const removed = lines.length - filtered.length;
      logger.info(`  ✓ Removed ${removed} trade-bot cron entries`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`  ⚠ Failed to remove crons: ${msg}`);
    }
  }

  private installCronsFromConfig(): void {
    if (!existsSync(CRON_CONFIG_PATH)) {
      logger.warn(`  ⚠ cron-config.json not found at ${CRON_CONFIG_PATH} — skipping`);
      return;
    }

    let config: CronEntry[];
    try {
      const raw = readFileSync(CRON_CONFIG_PATH, "utf-8");
      config = JSON.parse(raw) as CronEntry[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`  ✗ Failed to parse cron-config.json: ${msg}`);
      return;
    }

    if (!Array.isArray(config) || config.length === 0) {
      logger.warn("  ⚠ cron-config.json is empty — no crons to install");
      return;
    }

    // Build cron entries
    const nodeDir = this.detectNodeDir();
    const cronLines = config.map((entry, idx) => {
      const lockFile = `/tmp/trade-bot-${idx + 1}.lock`;
      const logFile = "/var/log/trade-bot.log";
      return `${entry.schedule} flock -n ${lockFile} bash -c 'cd ${WORKER_DIR} && ${nodeDir}/npx tsx ${entry.command}' >> ${logFile} 2>&1`;
    });

    try {
      const currentCrontab = execSync("crontab -l 2>/dev/null || true", { encoding: "utf-8" }).trim();
      const combined = currentCrontab
        ? `${currentCrontab}\n\n${cronLines.join("\n\n")}\n`
        : `${cronLines.join("\n\n")}\n`;
      execSync(`echo '${combined.replace(/'/g, "'\\''")}' | crontab -`, { encoding: "utf-8" });
      logger.info(`  ✓ Installed ${cronLines.length} cron entries`);
      for (const entry of config) {
        logger.info(`    • ${entry.name}: "${entry.schedule}" → ${entry.command}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`  ✗ Failed to install crons: ${msg}`);
    }
  }

  private detectNodeDir(): string {
    return "/home/ec2-user/.nvm/versions/node/v24.15.0/bin";
  }
}
