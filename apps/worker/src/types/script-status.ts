export interface ScriptStatus {
  status: "running" | "stopped" | "errored";
  /** ISO timestamp of last heartbeat */
  lastHeartbeat: string;
  /** ISO timestamp when script started */
  startedAt: string;
  error: string | null;
  metadata: Record<string, unknown>;
}
