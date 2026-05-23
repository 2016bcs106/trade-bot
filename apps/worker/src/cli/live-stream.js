/**
 * Live Market Data Stream — Long-Running Recorder
 *
 * Connects to Paytm Money's WebSocket API, streams real-time price data,
 * buffers ticks in memory, and flushes to disk as NDJSON files.
 *
 * Usage:
 *   node src/cli/live-stream.js [options]
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

import "../config/env.js";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, appendFileSync, statSync } from "fs";
import TradingConfig from "../config/trading-config.js";
import FirebaseClient from "../firebase/client.js";
import PaytmMoneyWebSocket from "../data/providers/paytm-money-websocket.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = new TradingConfig("live-stream");

const { scripId, scripType, exchangeType, modeType, flushInterval: flushIntervalSec, bufferSize: maxBufferSize, statsInterval: statsIntervalSec } = config;

// ─── Data directory setup ───────────────────────────────────────────
const dataDir = resolve(__dirname, "..", "..", "..", "..", "data");
mkdirSync(dataDir, { recursive: true });

function getDateIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function getTimeIST() {
  return new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
}

function getOutputFilePath() {
  return resolve(dataDir, `${exchangeType}_${scripId}_${getDateIST()}.ndjson`);
}

function getFileSizeMB(filePath) {
  try { return (statSync(filePath).size / (1024 * 1024)).toFixed(2); }
  catch { return "0.00"; }
}

// ─── In-memory buffer ───────────────────────────────────────────────
let buffer = [];
let totalFlushed = 0;
let totalFlushedToday = 0;
let lastFlushDate = getDateIST();

function flushBuffer() {
  if (buffer.length === 0) return;

  const today = getDateIST();
  if (today !== lastFlushDate) {
    console.log(`\n📅 New trading day: ${today}`);
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
    console.log(`  💾 [${getTimeIST()}] Flushed ${flushedCount} ticks → ${getFileSizeMB(filePath)}MB (total: ${totalFlushed})`);
  } catch (err) {
    console.error(`  ❌ [${getTimeIST()}] Flush error: ${err.message}`);
  }
}

// ─── Stats ──────────────────────────────────────────────────────────
let tickCount = 0;
let tickCountAtLastStats = 0;
const startTime = Date.now();

function logStats() {
  const uptimeMin = Math.round((Date.now() - startTime) / 1000 / 60);
  const ticksPerSec = ((tickCount - tickCountAtLastStats) / statsIntervalSec).toFixed(1);
  const memUsageMB = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);

  console.log(
    `  📊 [${getTimeIST()}] uptime=${uptimeMin}m | ticks=${tickCount} (today=${totalFlushedToday}) | ` +
    `rate=${ticksPerSec}/s | buffer=${buffer.length} | file=${getFileSizeMB(getOutputFilePath())}MB | mem=${memUsageMB}MB`
  );

  tickCountAtLastStats = tickCount;
}

// ─── Firebase + Streamer ────────────────────────────────────────────
const firebase = new FirebaseClient();
let currentToken = null;
let streamer = null;

// ─── Startup banner ─────────────────────────────────────────────────
console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
console.log(`║  Live Market Data Recorder                                   ║`);
console.log(`╠══════════════════════════════════════════════════════════════╣`);
console.log(`║  Scrip:    ${exchangeType}:${scripId} (${scripType})`.padEnd(64) + `║`);
console.log(`║  Mode:     ${modeType}`.padEnd(64) + `║`);
console.log(`║  Flush:    every ${flushIntervalSec}s or ${maxBufferSize} ticks`.padEnd(64) + `║`);
console.log(`║  Stats:    every ${statsIntervalSec}s`.padEnd(64) + `║`);
console.log(`║  Output:   ${dataDir}/`.padEnd(64) + `║`);
console.log(`║  Started:  ${getDateIST()} ${getTimeIST()}`.padEnd(64) + `║`);
console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
console.log(`Press Ctrl+C to stop.\n`);

// ─── Streamer lifecycle ─────────────────────────────────────────────
function createStreamer(token) {
  const s = new PaytmMoneyWebSocket(token);

  s.on("connected", () => {
    console.log(`  ✅ [${getTimeIST()}] Connected to WebSocket`);
    s.subscribe({ scripType, exchangeType, scripId, modeType });
  });

  s.on("tick", (data) => {
    tickCount++;
    buffer.push({ ...data, received_at: new Date().toISOString() });
    if (buffer.length >= maxBufferSize) flushBuffer();
  });

  s.on("error", (err) => console.error(`  ⚠️  [${getTimeIST()}] Error: ${err.message}`));
  s.on("disconnected", ({ code }) => { flushBuffer(); console.log(`  🔌 [${getTimeIST()}] Disconnected (code=${code})`); });
  s.on("reconnecting", (n) => console.log(`  🔄 [${getTimeIST()}] Reconnecting... attempt ${n}`));

  return s;
}

// ─── Listen to token changes ────────────────────────────────────────
firebase.onPublicAccessTokenChange((token) => {
  const isFirstConnect = currentToken === null;
  currentToken = token;

  if (isFirstConnect) {
    console.log(`  🔑 [${getTimeIST()}] Token loaded from Firebase`);
  } else {
    console.log(`  🔑 [${getTimeIST()}] Token updated — reconnecting...`);
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
function shutdown(reason) {
  clearInterval(flushTimer);
  clearInterval(statsTimer);
  flushBuffer();

  const uptimeMin = Math.round((Date.now() - startTime) / 1000 / 60);
  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  Shutdown: ${reason}`.padEnd(64) + `║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  Uptime:       ${uptimeMin} minutes`.padEnd(64) + `║`);
  console.log(`║  Total ticks:  ${tickCount}`.padEnd(64) + `║`);
  console.log(`║  Written:      ${totalFlushed} ticks`.padEnd(64) + `║`);
  console.log(`║  Today's file: ${getFileSizeMB(getOutputFilePath())} MB`.padEnd(64) + `║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

  if (streamer) streamer.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  console.error(`  ❌ [${getTimeIST()}] Uncaught exception: ${err.message}`);
  console.error(err.stack);
});

process.on("unhandledRejection", (reason) => {
  console.error(`  ❌ [${getTimeIST()}] Unhandled rejection:`, reason);
});
