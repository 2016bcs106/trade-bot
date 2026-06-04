import { nowISO } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import FirebaseClient from "../firebase/client.ts";
import { ScriptStatus } from "../types/script-status.ts";
import { Logger } from "../types/logger.ts";

const HEARTBEAT_INTERVAL_MS = 60_000;

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
