import moment, { Moment } from "moment";

/**
 * Centralized time utility — ALL scripts must use this instead of raw Date.
 *
 * Default timezone: IST (UTC+05:30)
 * This ensures consistent timestamps across all worker scripts.
 */

const IST_OFFSET = "+05:30";

/** Get current moment in IST */
export function now(): Moment {
  return moment().utcOffset(IST_OFFSET);
}

/** Get current epoch timestamp (ms) */
export function nowMs(): number {
  return moment().valueOf();
}

/** Get current ISO string in IST (e.g., "2025-05-24T18:30:00+05:30") */
export function nowISO(): string {
  return now().format();
}

/** Get current date string in IST (e.g., "2025-05-24") */
export function todayDate(): string {
  return now().format("YYYY-MM-DD");
}

/** Get formatted timestamp for display (e.g., "2025-05-24 18:30:00") */
export function nowFormatted(): string {
  return now().format("YYYY-MM-DD HH:mm:ss");
}

/** Get a filename-safe timestamp (e.g., "2025-05-24T18-30-00") */
export function nowFilenameSafe(): string {
  return now().format("YYYY-MM-DDTHH-mm-ss");
}

/**
 * Parse a date string into a Moment in IST. Uses `utcOffset(offset, keepLocalTime=true)` --
 * critical when parsing a naive string with no embedded timezone (e.g. NSE/BSE's exchange
 * timestamps, which are always IST wall-clock values): without keepLocalTime, `.utcOffset()`
 * shifts the underlying instant to match the new offset rather than just tagging the existing
 * wall-clock digits as IST. `moment(date, format)` parses using the process's local system
 * timezone, so on a server whose system time isn't already IST (production runs in UTC), the
 * un-flagged version silently rolled timestamps forward -- e.g. "16-Jul-2026 19:03:54" (IST)
 * became "2026-07-17 00:33:54", corrupting which trading day a same-day-evening announcement
 * resolved to for release-price lookups. Safe for the single-arg (no format) case too: its only
 * caller re-parses nowISO() output, which already carries an explicit +05:30 offset, so shifting
 * to +05:30 is a no-op regardless of this flag.
 */
export function parseDate(date: string, format?: string): Moment {
  return format ? moment(date, format).utcOffset(IST_OFFSET, true) : moment(date).utcOffset(IST_OFFSET, true);
}

/** Whether the given ISO timestamp falls on the current IST calendar day */
export function isFreshToday(updatedOn: string | null): boolean {
  if (!updatedOn) return false;
  return parseDate(updatedOn).isSameOrAfter(now().startOf("day"));
}

export default { now, nowMs, nowISO, todayDate, nowFormatted, nowFilenameSafe, parseDate, isFreshToday };
