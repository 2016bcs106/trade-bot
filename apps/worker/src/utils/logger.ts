import moment from "moment";
import { Logger } from "../types/logger.ts";

function getTimestampIST(): string {
  return moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss");
}

function formatMessage(level: string, script: string, message: string, meta?: unknown): string {
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

export default function createLogger(script: string): Logger {
  return {
    info(message: string, meta?: unknown) {
      console.log(formatMessage("INFO", script, message, meta));
    },

    warn(message: string, meta?: unknown) {
      console.warn(formatMessage("WARN", script, message, meta));
    },

    error(message: string, meta?: unknown) {
      console.error(formatMessage("ERROR", script, message, meta));
    },

    debug(message: string, meta?: unknown) {
      if (process.env.LOG_LEVEL === "debug") {
        console.debug(formatMessage("DEBUG", script, message, meta));
      }
    },
  };
}
