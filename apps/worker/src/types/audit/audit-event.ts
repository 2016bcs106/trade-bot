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

  /** IST timestamp when the event occurred (YYYY-MM-DD HH:mm:ss) */
  timestamp: string;

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
  // System events
  | "system.error";
