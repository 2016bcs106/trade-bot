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

export default { now, nowMs, nowISO, todayDate, nowFormatted, nowFilenameSafe };
