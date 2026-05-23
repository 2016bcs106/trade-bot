/**
 * Audit event stored at `audit/EVENT_ID/`
 * Provides a chronological log of all system activities.
 */
export interface AuditEvent {
  /** Unique event ID (Firebase push key) */
  id: string;

  /** Event type categorization */
  type: AuditEventType;

  /** Stock symbol associated with the event (null for system-wide events) */
  symbol: string | null;

  /** Human-readable description of what happened */
  description: string;

  /** ISO timestamp when the event occurred */
  timestamp: number;

  /** Additional context/metadata specific to the event type */
  metadata: Record<string, unknown>;
}

/** All possible audit event types */
export type AuditEventType =
  // Stock lifecycle
  | "stock.added"
  | "stock.removed"
  | "stock.enabled"
  | "stock.disabled"
  | "stock.config_updated"
  // Training lifecycle
  | "training.started"
  | "training.completed"
  | "training.failed"
  // Model lifecycle
  | "model.promoted"
  | "model.retired"
  | "model.rollback"
  | "model.auto_promoted"
  // Prediction lifecycle
  | "prediction.generated"
  | "prediction.failed"
  // Evaluation lifecycle
  | "evaluation.completed"
  | "evaluation.failed"
  // System events
  | "scheduler.started"
  | "scheduler.stopped"
  | "system.error";
