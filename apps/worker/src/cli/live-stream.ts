/**
 * Live Market Data Stream — Long-Running Recorder
 *
 * Connects to Paytm Money's WebSocket API, streams real-time price data,
 * buffers ticks in memory, and flushes to disk as NDJSON files.
 *
 * Usage:
 *   npx tsx src/cli/live-stream.ts [options]
 *
 * Options:
 *   --scripId=25          Security ID (default: 25)
 *   --scripType=EQUITY    EQUITY | INDEX | ETF | FUTURE | OPTION (default: EQUITY)
 *   --exchangeType=NSE    NSE | BSE (default: NSE)
 *   --modeType=FULL       LTP | QUOTE | FULL (default: FULL)
 *   --flushInterval=60    Seconds between disk flushes (default: 60)
 *   --bufferSize=1000     Max ticks in buffer before forced flush (default: 1000)
 *   --statsInterval=300   Seconds between stats log (default: 300 = 5min)
 */

import "../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, appendFileSync, statSync } from "fs";
import moment from "moment";
import createLogger from "../utils/logger.ts";
import TradingConfig from "../config/trading-config.ts";
import FirebaseClient from "../firebase/client.ts";
import PaytmMoneyWebSocket from "../data/providers/paytm-money-websocket.ts";

const log = createLogger("live-stream");
const __dirname = dirname(fileURLToPath(import.meta.url));
const config = new TradingConfig("live-stream");

const scripId = config.scripId;
const scripType = config.scripType;
const exchangeType = config.exchangeType;
const modeType = config.modeType!;
const flushIntervalSec = config.flushInterval!;
const maxBufferSize = config.bufferSize!;
const statsIntervalSec = config.statsInterval!;

// ─── Data directory setup ───────────────────────────────────────────
const dataDir = resolve(__dirname, "..", "..", "..", "..", "data");
mkdirSync(dataDir, { recursive: true });

function getDateIST(): string {
  return moment().utcOffset("+05:30").format("YYYY-MM-DD");
}

function getOutputFilePath(): string {
  return resolve(dataDir, `${exchangeType}_${scripId}_${getDateIST()}.ndjson`);
}

function getFileSizeMB(filePath: string): string {
  try { return (statSync(filePath).size / (1024 * 1024)).toFixed(2); }
  catch { return "0.00"; }
}

// ─── In-memory buffer ───────────────────────────────────────────────
let buffer: Record<string, unknown>[] = [];
let totalFlushed = 0;
let totalFlushedToday = 0;
let lastFlushDate = getDateIST();

function flushBuffer(): void {
  if (buffer.length === 0) return;

  const today = getDateIST();
  if (today !== lastFlushDate) {
    log.info(`New trading day: ${today}`);
    totalFlushedToday = 0;
    lastFlushDate = today;
  }

  const filePath = getOutputFilePath();
  const lines = buffer.map((tick) => JSON.stringify(tick)).join("\n") + "\n";

  try {
    const flushedCount = buffer.length;
    appendFileSync(filePath, lines);
    totalFlushed += flushedCount;
    totalFlushedToday += flushedCount;
    buffer = [];
    log.info(`Flushed ${flushedCount} ticks — file=${getFileSizeMB(filePath)}MB total=${totalFlushed}`);
  } catch (err) {
    log.error("Flush error", err);
  }
}

// ─── Stats ──────────────────────────────────────────────────────────
let tickCount = 0;
let tickCountAtLastStats = 0;
const startTime = Date.now();

function logStats(): void {
  const uptimeMin = Math.round((Date.now() - startTime) / 1000 / 60);
  const ticksPerSec = ((tickCount - tickCountAtLastStats) / statsIntervalSec).toFixed(1);
  const memUsageMB = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);

  log.info(
    `Stats — uptime=${uptimeMin}m ticks=${tickCount} today=${totalFlushedToday} ` +
    `rate=${ticksPerSec}/s buffer=${buffer.length} file=${getFileSizeMB(getOutputFilePath())}MB mem=${memUsageMB}MB`,
  );

  tickCountAtLastStats = tickCount;
}

// ─── Firebase + Streamer ────────────────────────────────────────────
const firebase = new FirebaseClient();
let currentToken: string | null = null;
let streamer: PaytmMoneyWebSocket | null = null;

// ─── Startup ────────────────────────────────────────────────────────
log.info("Starting live market data recorder");
log.info(`Config — scrip=${exchangeType}:${scripId}(${scripType}) mode=${modeType} flush=${flushIntervalSec}s buffer=${maxBufferSize} stats=${statsIntervalSec}s`);
log.info(`Output directory: ${dataDir}`);

// ─── Streamer lifecycle ─────────────────────────────────────────────
function createStreamer(token: string): PaytmMoneyWebSocket {
  const s = new PaytmMoneyWebSocket(token);

  s.on("connected", () => {
    log.info("WebSocket connected");
    s.subscribe({ scripType, exchangeType, scripId, modeType });
  });

  s.on("tick", (data: Record<string, unknown>) => {
    tickCount++;
    buffer.push({ ...data, received_at: new Date().toISOString() });
    if (buffer.length >= maxBufferSize) flushBuffer();
  });

  s.on("error", (err: Error) => log.error("WebSocket error", err));
  s.on("disconnected", ({ code }: { code: number }) => { flushBuffer(); log.warn(`WebSocket disconnected — code=${code}`); });
  s.on("reconnecting", (n: number) => log.info(`WebSocket reconnecting — attempt ${n}`));

  return s;
}

// ─── Listen to token changes ────────────────────────────────────────
firebase.onPublicAccessTokenChange((token: string) => {
  const isFirstConnect = currentToken === null;
  currentToken = token;

  if (isFirstConnect) {
    log.info("Public access token loaded from Firebase");
  } else {
    log.info("Public access token updated — reconnecting WebSocket");
    flushBuffer();
    if (streamer) streamer.disconnect();
  }

  streamer = createStreamer(currentToken);
  streamer.connect();
});

// ─── Timers ─────────────────────────────────────────────────────────
const flushTimer = setInterval(flushBuffer, flushIntervalSec * 1000);
const statsTimer = setInterval(logStats, statsIntervalSec * 1000);

// ─── Graceful shutdown ──────────────────────────────────────────────
function shutdown(reason: string): void {
  clearInterval(flushTimer);
  clearInterval(statsTimer);
  flushBuffer();

  const uptimeMin = Math.round((Date.now() - startTime) / 1000 / 60);
  log.info(`Shutdown — reason=${reason} uptime=${uptimeMin}m ticks=${tickCount} written=${totalFlushed} file=${getFileSizeMB(getOutputFilePath())}MB`);

  if (streamer) streamer.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err: Error) => {
  log.error("Uncaught exception", err);
});

process.on("unhandledRejection", (reason: unknown) => {
  log.error("Unhandled rejection", reason instanceof Error ? reason : new Error(String(reason)));
});
