import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { now } from "../utils/time.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { Logger } from "../types/logger.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";

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
  private log!: Logger;

  async handle(_request: QueuedRequest, _ctx: ServiceContext): Promise<void> {
    this.log = _ctx.log;
    this.log.info("=== SYSTEM UPDATE STARTED ===");

    // ─── Step 1: Git stash ───────────────────────────────────────────
    this.log.info("Step 1: Stashing local changes...");
    this.exec("git add -A", PROJECT_ROOT);
    this.exec("git stash", PROJECT_ROOT);

    // ─── Step 2: Git pull --rebase ───────────────────────────────────
    this.log.info("Step 2: Pulling latest code...");
    const pullOutput = this.exec("git pull --rebase origin master", PROJECT_ROOT);

    if (pullOutput.includes("Already up to date") || pullOutput.includes("Current branch master is up to date")) {
      this.log.info("  No new commits — nothing to deploy");
      this.log.info("=== SYSTEM UPDATE COMPLETE (no changes) ===");
      return;
    }

    // ─── Step 3: Detect what changed ──────────────────────────────────
    this.log.info("Step 3: Detecting changes...");
    const changedFiles = this.exec("git diff-tree --name-only -r HEAD", PROJECT_ROOT).trim();
    const hasFrontendChanges = changedFiles.split("\n").some((f) => f.includes("frontend"));
    const hasWorkerChanges = changedFiles.split("\n").some((f) => f.includes("worker"));
    this.log.info(`  Frontend changes: ${hasFrontendChanges}, Worker changes: ${hasWorkerChanges}`);

    // ─── Step 4: Deploy frontend (if changed) ────────────────────────
    if (hasFrontendChanges) {
      this.log.info("Step 4: Deploying frontend...");
      try {
        const frontendDir = resolve(PROJECT_ROOT, "apps", "frontend");
        this.exec("pnpm --filter frontend build", PROJECT_ROOT);
        this.exec("firebase deploy --only hosting", frontendDir);
        this.log.info("  ✓ Frontend deployed");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`  ⚠ Frontend deploy failed (non-fatal): ${msg}`);
      }
    } else {
      this.log.info("Step 4: Skipping frontend deploy (no changes)");
    }

    // ─── Step 5: Reinstall crons (if worker changed) ─────────────────
    if (hasWorkerChanges) {
      this.log.info("Step 5: Removing existing trade-bot crons...");
      this.removeTradeBotCrons();
      this.log.info("Step 6: Installing new crons from cron-config.json...");
      this.installCronsFromConfig();
    } else {
      this.log.info("Step 5-6: Skipping cron reinstall (no worker changes)");
    }

    // ─── Step 7: Remove this request from Firebase before killing ────
    if (_request._key) {
      this.log.info("Step 7: Removing request from queue...");
      await _ctx.firebase.removeRequest(_request._key);
    }

    // ─── Step 8: Restart worker processes (only if worker changed) ───
    if (hasWorkerChanges) {
      await this.waitUntilSecond55();

      this.log.info("Step 8: Killing all running trade-bot processes...");
      this.log.info("=== SYSTEM UPDATE COMPLETE — restarting via cron ===");

      await new Promise((r) => setTimeout(r, 500));

      try {
        execSync(
          `ps aux | grep "[t]rade-bot" | awk '{print $2}' | xargs kill 2>/dev/null || true`,
          { stdio: "ignore" },
        );
      } catch {
        // Expected to fail when killing self
      }

      process.exit(0);
    } else {
      this.log.info("Step 8: Skipping restart (no worker changes)");
      this.log.info("=== SYSTEM UPDATE COMPLETE ===");
    }
  }

  /**
   * Wait until the current minute reaches second 55.
   * This minimizes downtime since cron will restart processes at the next :00.
   * If already past :55, proceeds immediately.
   */
  private async waitUntilSecond55(): Promise<void> {
    const currentSecond = now().second();

    if (currentSecond >= 55) {
      this.log.info(`  Current second: ${currentSecond} — proceeding immediately`);
      return;
    }

    const waitMs = (55 - currentSecond) * 1000;
    this.log.info(`  Current second: ${currentSecond} — waiting ${55 - currentSecond}s until :55...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  private exec(command: string, cwd: string): string {
    this.log.info(`  $ ${command}`);
    const nodeDir = this.detectNodeDir();
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      timeout: 120_000, // 2 minute timeout
      env: { ...process.env, PATH: `${nodeDir}:${process.env.PATH}` },
    });
    if (output.trim()) {
      this.log.info(`  → ${output.trim().split("\n").slice(0, 5).join("\n    ")}`);
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
      this.log.info(`  ✓ Removed ${removed} trade-bot cron entries`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`  ⚠ Failed to remove crons: ${msg}`);
    }
  }

  private installCronsFromConfig(): void {
    if (!existsSync(CRON_CONFIG_PATH)) {
      this.log.warn(`  ⚠ cron-config.json not found at ${CRON_CONFIG_PATH} — skipping`);
      return;
    }

    let config: CronEntry[];
    try {
      const raw = readFileSync(CRON_CONFIG_PATH, "utf-8");
      config = JSON.parse(raw) as CronEntry[];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`  ✗ Failed to parse cron-config.json: ${msg}`);
      return;
    }

    if (!Array.isArray(config) || config.length === 0) {
      this.log.warn("  ⚠ cron-config.json is empty — no crons to install");
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
      this.log.info(`  ✓ Installed ${cronLines.length} cron entries`);
      for (const entry of config) {
        this.log.info(`    • ${entry.name}: "${entry.schedule}" → ${entry.command}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`  ✗ Failed to install crons: ${msg}`);
    }
  }

  private detectNodeDir(): string {
    return "/home/ec2-user/.nvm/versions/node/v24.15.0/bin";
  }
}
