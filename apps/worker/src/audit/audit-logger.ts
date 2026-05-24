import { now } from "../utils/time.ts";
import { AuditEvent, AuditEventType } from "../types/audit/audit-event.ts";

/**
 * Audit logger — records all significant system events.
 *
 * Events are stored in Firebase at `audit/EVENT_ID/`.
 * Each event captures: what happened, when, which stock, and metadata.
 *
 * This class builds AuditEvent objects; the caller is responsible for
 * persisting them to Firebase via FirebaseClient.
 */
export default class AuditLogger {
  /**
   * Create an audit event ready for Firebase storage.
   */
  createEvent(
    type: AuditEventType,
    description: string,
    symbol: string | null = null,
    metadata: Record<string, unknown> = {},
  ): AuditEvent {
    const current = now();

    return {
      id: this.generateId(type, current),
      type,
      symbol,
      description,
      timestamp: current.format("YYYY-MM-DD HH:mm:ss"),
      metadata,
    };
  }

  // ─── Convenience Methods ───────────────────────────────────────────

  stockAdded(symbol: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return this.createEvent("stock.added", `Stock ${symbol} added to tracking`, symbol, metadata);
  }

  stockRemoved(symbol: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return this.createEvent("stock.removed", `Stock ${symbol} removed from tracking`, symbol, metadata);
  }

  stockEnabled(symbol: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return this.createEvent("stock.enabled", `Stock ${symbol} enabled`, symbol, metadata);
  }

  stockDisabled(symbol: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return this.createEvent("stock.disabled", `Stock ${symbol} disabled`, symbol, metadata);
  }

  trainingStarted(symbol: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return this.createEvent("training.started", `Training started for ${symbol}`, symbol, metadata);
  }

  trainingCompleted(symbol: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return this.createEvent("training.completed", `Training completed for ${symbol}`, symbol, metadata);
  }

  trainingFailed(symbol: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return this.createEvent("training.failed", `Training failed for ${symbol}`, symbol, metadata);
  }

  modelPromoted(symbol: string, version: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return this.createEvent("model.promoted", `Model ${version} promoted to production for ${symbol}`, symbol, { version, ...metadata });
  }

  modelRolledBack(symbol: string, fromVersion: string, toVersion: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return this.createEvent("model.rollback", `Model rolled back from ${fromVersion} to ${toVersion} for ${symbol}`, symbol, { fromVersion, toVersion, ...metadata });
  }

  predictionGenerated(symbol: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return this.createEvent("prediction.generated", `Prediction generated for ${symbol}`, symbol, metadata);
  }

  evaluationCompleted(symbol: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return this.createEvent("evaluation.completed", `Evaluation completed for ${symbol}`, symbol, metadata);
  }

  systemError(description: string, metadata: Record<string, unknown> = {}): AuditEvent {
    return this.createEvent("system.error", description, null, metadata);
  }

  /**
   * Generate a unique event ID: TYPE_YYYYMMDD_HHmmss_random
   */
  private generateId(type: AuditEventType, timestamp: { format(f: string): string }): string {
    const dateStr = timestamp.format("YYYYMMDD_HHmmss");
    const random = Math.random().toString(36).substring(2, 8);
    return `${type.replace(".", "_")}_${dateStr}_${random}`;
  }
}
