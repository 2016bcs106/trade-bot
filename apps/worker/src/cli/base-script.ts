import moment from "moment";
import { nowISO, nowMs } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import FirebaseClient from "../firebase/client.ts";
import { ScriptStatus } from "../types/script-status.ts";
import { Logger } from "../types/logger.ts";

const HEARTBEAT_INTERVAL_MS = 60_000;
// A "running" status is only trusted as a live lock while its heartbeat is this fresh. Beyond
// this, it's treated as a crashed process that never got to report "stopped"/"errored" (e.g.
// killed, OOM), so a new run is allowed to proceed rather than being blocked forever.
const STALE_LOCK_MS = 3 * HEARTBEAT_INTERVAL_MS;

/**
 * Abstract base class for all CLI scripts.
 * Provides automatic heartbeat reporting to Firebase every 60 seconds.
 *
 * Subclasses must implement:
 *   - scriptName: unique identifier for this script
 *   - run(): the main script logic
 *   - getMetadata(): script-specific metadata to include in heartbeat
 */
export default abstract class BaseScript {
  protected firebase: FirebaseClient;
  protected log!: Logger;
  private startedAt: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastError: string | null = null;

  constructor() {
    this.firebase = new FirebaseClient();
    this.startedAt = nowISO();
  }

  /** Unique name for this script (used as Firebase key) */
  abstract get scriptName(): string;

  /** Main script logic — override in subclass */
  protected abstract run(): Promise<void>;

  /** Script-specific metadata to include in each heartbeat */
  protected abstract getMetadata(): Record<string, unknown>;

  /** Entry point — call this to start the script */
  async start(): Promise<void> {
    this.log = createLogger(this.scriptName);
    this.log.info("Script starting...");

    // Overlap protection: if a cron-scheduled run takes longer than the schedule interval (e.g.
    // reprocessing a large backlog), the next scheduled run must not start concurrently -- both
    // instances would re-read the same stale Firebase snapshot, redo the same work, and race on
    // the final write. Reuses the existing status/heartbeat reporting as the lock signal rather
    // than a separate lock node; a stale heartbeat (crashed process) never blocks a new run.
    if (await this.isAnotherInstanceRunning()) {
      this.log.info("Another instance is already running (fresh heartbeat) — skipping this run.");
      // Firebase's realtime connection is a WebSocket that keeps the event loop alive by design
      // -- without explicitly closing it here, a skipped process never exits on its own, and
      // cron keeps spawning a new one every interval on top of it (exactly the process pile-up
      // this check was meant to prevent, just moved one level down).
      await this.firebase.destroy();
      return;
    }

    this.setupShutdownHandlers();
    this.startHeartbeat();

    try {
      await this.reportStatus("running");
      await this.run();
      this.stopHeartbeat();
      await this.reportStatus("stopped");
      await this.firebase.destroy();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.log.error("Script crashed", error);
      await this.reportStatus("errored");
      process.exit(1);
    }
  }

  /** Whether Firebase already shows this script "running" with a heartbeat recent enough to trust as a live instance, not a crashed one. */
  private async isAnotherInstanceRunning(): Promise<boolean> {
    try {
      const existing = (await this.firebase.getValue(`scripts/${this.scriptName}`)) as ScriptStatus | null;
      if (!existing || existing.status !== "running") return false;
      const heartbeatAgeMs = nowMs() - moment(existing.lastHeartbeat).valueOf();
      return heartbeatAgeMs < STALE_LOCK_MS;
    } catch (err) {
      this.log.warn("Failed to check for a running instance — proceeding anyway", err);
      return false;
    }
  }

  /** Report current status to Firebase */
  private async reportStatus(status: ScriptStatus["status"]): Promise<void> {
    const payload: ScriptStatus = {
      status,
      lastHeartbeat: nowISO(),
      startedAt: this.startedAt,
      error: this.lastError,
      metadata: this.getMetadata(),
    };

    try {
      await this.firebase.updateScriptStatus(this.scriptName, payload);
    } catch (err) {
      this.log.error("Failed to report status to Firebase", err);
    }
  }

  /** Start the periodic heartbeat */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      await this.reportStatus(this.lastError ? "errored" : "running");
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** Stop the heartbeat timer */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Register shutdown handlers */
  private setupShutdownHandlers(): void {
    const shutdown = async (reason: string) => {
      this.log.info(`Shutting down — reason=${reason}`);
      this.stopHeartbeat();
      await this.reportStatus("stopped");
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    process.on("uncaughtException", async (err: Error) => {
      this.lastError = err.message;
      this.log.error("Uncaught exception", err);
      await this.reportStatus("errored");
      process.exit(1);
    });

    process.on("unhandledRejection", async (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      this.lastError = message;
      this.log.error("Unhandled rejection", reason instanceof Error ? reason : new Error(message));
      await this.reportStatus("errored");
      process.exit(1);
    });
  }
}
