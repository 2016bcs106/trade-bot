import moment from "moment";

/**
 * Production-quality structured logger.
 * All log lines include: [LEVEL] [YYYY-MM-DD HH:mm:ss] [script-name] message
 *
 * Usage:
 *   import createLogger from "../utils/logger.js";
 *   const log = createLogger("trade-bot");
 *   log.info("Bot started");
 *   log.error("Something failed", error);
 */

function getTimestampIST() {
  return moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss");
}

function formatMessage(level, script, message, meta) {
  const timestamp = getTimestampIST();
  const prefix = `[${level}] [${timestamp}] [${script}]`;

  if (meta !== undefined) {
    const metaStr = meta instanceof Error
      ? `${meta.message}\n${meta.stack}`
      : typeof meta === "object"
        ? JSON.stringify(meta)
        : String(meta);
    return `${prefix} ${message} ${metaStr}`;
  }

  return `${prefix} ${message}`;
}

export default function createLogger(script) {
  return {
    info(message, meta) {
      console.log(formatMessage("INFO", script, message, meta));
    },

    warn(message, meta) {
      console.warn(formatMessage("WARN", script, message, meta));
    },

    error(message, meta) {
      console.error(formatMessage("ERROR", script, message, meta));
    },

    debug(message, meta) {
      if (process.env.LOG_LEVEL === "debug") {
        console.debug(formatMessage("DEBUG", script, message, meta));
      }
    },
  };
}
