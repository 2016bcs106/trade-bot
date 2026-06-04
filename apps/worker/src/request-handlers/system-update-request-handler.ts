import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { QueuedRequest } from "../firebase/client.ts";
import { Logger } from "../types/logger.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..", "..");
const WORKER_DIR = resolve(PROJECT_ROOT, "apps", "worker");
const CRON_CONFIG_PATH = resolve(WORKER_DIR, "cron-config.json");
const SYSTEMD_DIR = resolve(WORKER_DIR, "systemd");

const SERVICES = [
  "trade-bot-live-stream",
  "trade-bot-request-handler",
  "trade-bot-market-status",
];

interface CronEntry {
  name: string;
  schedule: string;
  command: string;
}

/**
 * Handles "system_update" requests — performs a full deployment cycle:
 *
 * 1. Git stash + pull
 * 2. Detect what changed (frontend/worker)
 * 3. Deploy frontend if changed
 * 4. Reinstall systemd services + crons if worker changed
 * 5. Restart services immediately via systemctl
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

    // ─── Step 5: Update worker (if changed) ──────────────────────────
    if (hasWorkerChanges) {
      this.log.info("Step 5: Installing systemd services...");
      this.installSystemdServices();

      this.log.info("Step 6: Reinstalling crons...");
      this.removeTradeBotCrons();
      this.installCronsFromConfig();

      // Remove request before restarting (we'll be killed)
      if (_request._key) {
        this.log.info("Step 7: Removing request from queue...");
        await _ctx.firebase.removeRequest(_request._key);
      }

      this.log.info("Step 8: Restarting services...");
      this.restartServices();

      this.log.info("=== SYSTEM UPDATE COMPLETE — services restarting ===");
      await new Promise((r) => setTimeout(r, 500));
      process.exit(0);
    } else {
      this.log.info("Step 5-8: Skipping worker update (no changes)");
      this.log.info("=== SYSTEM UPDATE COMPLETE ===");
    }
  }

  private installSystemdServices(): void {
    for (const service of SERVICES) {
      const srcPath = resolve(SYSTEMD_DIR, `${service}.service`);
      if (!existsSync(srcPath)) {
        this.log.warn(`  ⚠ Service file not found: ${srcPath}`);
        continue;
      }
      this.exec(`sudo cp ${srcPath} /etc/systemd/system/${service}.service`, PROJECT_ROOT);
      this.exec(`sudo systemctl enable ${service}`, PROJECT_ROOT);
      this.log.info(`  ✓ ${service} installed`);
    }
    this.exec("sudo systemctl daemon-reload", PROJECT_ROOT);
  }

  private restartServices(): void {
    for (const service of SERVICES) {
      try {
        this.exec(`sudo systemctl restart ${service}`, PROJECT_ROOT);
        this.log.info(`  ✓ ${service} restarted`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn(`  ⚠ Failed to restart ${service}: ${msg}`);
      }
    }
  }

  private exec(command: string, cwd: string): string {
    this.log.info(`  $ ${command}`);
    const nodeDir = this.detectNodeDir();
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      timeout: 120_000,
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
      this.log.warn(`  ⚠ cron-config.json not found — skipping`);
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

    const nodeDir = this.detectNodeDir();
    const cronLines = config.map((entry) => {
      const logFile = "/var/log/trade-bot.log";
      return `${entry.schedule} cd ${WORKER_DIR} && ${nodeDir}/npx tsx ${entry.command} >> ${logFile} 2>&1`;
    });

    try {
      const currentCrontab = execSync("crontab -l 2>/dev/null || true", { encoding: "utf-8" }).trim();
      const combined = currentCrontab
        ? `${currentCrontab}\n\n${cronLines.join("\n")}\n`
        : `${cronLines.join("\n")}\n`;
      execSync(`echo '${combined.replace(/'/g, "'\\''")}' | crontab -`, { encoding: "utf-8" });
      this.log.info(`  ✓ Installed ${cronLines.length} cron entries`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error(`  ✗ Failed to install crons: ${msg}`);
    }
  }

  private detectNodeDir(): string {
    return "/home/ec2-user/.nvm/versions/node/v24.15.0/bin";
  }
}
