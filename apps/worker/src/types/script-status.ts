export interface ScriptStatus {
  status: "running" | "stopped" | "errored";
  lastHeartbeat: number;
  startedAt: number;
  error: string | null;
  metadata: Record<string, unknown>;
}
