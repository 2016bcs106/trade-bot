/**
 * Live Market Data Stream — Long-Running Recorder
 *
 * Connects to Paytm Money's WebSocket API, streams real-time price data,
 * buffers ticks in memory, and flushes to disk as NDJSON files.
 * Designed to run continuously throughout market hours (and beyond).
 *
 * Data is stored in: backend/data/{exchangeType}_{scripId}_{YYYY-MM-DD}.ndjson
 *
 * Features:
 *   - In-memory buffering with periodic disk flush
 *   - Automatic daily file rotation (new file per trading day)
 *   - Market-hours awareness (logs when market opens/closes)
 *   - Periodic health/stats logging
 *   - Graceful shutdown with final flush on SIGINT/SIGTERM
 *   - Automatic reconnection handled by WebSocketStreamer
 *
 * Usage:
 *   node scripts/live-stream.js [options]
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

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { mkdirSync, appendFileSync, statSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

import { initializeApp } from "firebase/app";
import { getDatabase, onValue, ref } from "firebase/database";
import { WebSocketStreamer } from "../lib/websocket-streamer.js";

// ─── Parse CLI args ─────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
    return [key, valueParts.join("=")];
  })
);

const scripId = args.scripId || "25";
const scripType = args.scripType || "EQUITY";
const exchangeType = args.exchangeType || "NSE";
const modeType = args.modeType || "FULL";
const flushIntervalSec = args.flushInterval != null ? Number(args.flushInterval) : 60;
const maxBufferSize = args.bufferSize != null ? Number(args.bufferSize) : 1000;
const statsIntervalSec = args.statsInterval != null ? Number(args.statsInterval) : 300;

// ─── Data directory setup ───────────────────────────────────────────
const dataDir = resolve(__dirname, "..", "data");
mkdirSync(dataDir, { recursive: true });

function getDateIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

function getTimeIST() {
  return new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
}

function getOutputFilePath() {
  return resolve(dataDir, `${exchangeType}_${scripId}_${getDateIST()}.ndjson`);
}

function getFileSizeMB(filePath) {
  try {
    return (statSync(filePath).size / (1024 * 1024)).toFixed(2);
  } catch {
    return "0.00";
  }
}

// ─── In-memory buffer ───────────────────────────────────────────────
let buffer = [];
let totalFlushed = 0;
let totalFlushedToday = 0;
let lastFlushDate = getDateIST();

function flushBuffer() {
  if (buffer.length === 0) return;

  // Check for day rollover
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
    const fileSizeMB = getFileSizeMB(filePath);
    console.log(`  💾 [${getTimeIST()}] Flushed ${flushedCount} ticks → ${fileSizeMB}MB (total: ${totalFlushed})`);
  } catch (err) {
    console.error(`  ❌ [${getTimeIST()}] Flush error: ${err.message}`);
  }
}

// ─── Stats / Health logging ─────────────────────────────────────────
let tickCount = 0;
let tickCountAtLastStats = 0;
const startTime = Date.now();

function logStats() {
  const uptimeSec = Math.round((Date.now() - startTime) / 1000);
  const uptimeMin = Math.round(uptimeSec / 60);
  const ticksPerSec = ((tickCount - tickCountAtLastStats) / statsIntervalSec).toFixed(1);
  const filePath = getOutputFilePath();
  const fileSizeMB = getFileSizeMB(filePath);
  const memUsageMB = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);

  console.log(
    `  📊 [${getTimeIST()}] uptime=${uptimeMin}m | ticks=${tickCount} (today=${totalFlushedToday}) | ` +
    `rate=${ticksPerSec}/s | buffer=${buffer.length} | file=${fileSizeMB}MB | mem=${memUsageMB}MB`
  );

  tickCountAtLastStats = tickCount;
}

// ─── Firebase setup ─────────────────────────────────────────────────
const app = initializeApp({ databaseURL: process.env.FIREBASE_DATABASE_URL });
const db = getDatabase(app);
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
  const s = new WebSocketStreamer(token);

  s.on("connected", () => {
    console.log(`  ✅ [${getTimeIST()}] Connected to WebSocket`);
    s.subscribe({ scripType, exchangeType, scripId, modeType });
  });

  s.on("tick", (data) => {
    tickCount++;

    // Enrich with received timestamp
    const enrichedTick = {
      ...data,
      received_at: new Date().toISOString(),
    };

    buffer.push(enrichedTick);

    // Force flush if buffer exceeds max size
    if (buffer.length >= maxBufferSize) {
      flushBuffer();
    }
  });

  s.on("error", (err) => {
    console.error(`  ⚠️  [${getTimeIST()}] Error: ${err.message}`);
  });

  s.on("disconnected", ({ code }) => {
    flushBuffer(); // Flush before potential reconnect gap
    console.log(`  🔌 [${getTimeIST()}] Disconnected (code=${code})`);
  });

  s.on("reconnecting", (n) => {
    console.log(`  🔄 [${getTimeIST()}] Reconnecting... attempt ${n}`);
  });

  return s;
}

// ─── Listen to token changes in Firebase ────────────────────────────
const tokenRef = ref(db, "auth/publicAccessToken");

onValue(tokenRef, (snapshot) => {
  const authData = snapshot.val();

  if (!authData || !authData.token) {
    console.warn(`  ⚠️  [${getTimeIST()}] No token in Firebase. Waiting for login...`);
    return;
  }

  // Skip if token hasn't changed
  if (authData.token === currentToken) return;

  const isFirstConnect = currentToken === null;
  currentToken = authData.token;

  if (isFirstConnect) {
    console.log(`  🔑 [${getTimeIST()}] Token loaded from Firebase`);
  } else {
    console.log(`  🔑 [${getTimeIST()}] Token updated in Firebase — reconnecting with new token...`);
    // Flush buffer before switching
    flushBuffer();
    // Disconnect old streamer
    if (streamer) {
      streamer.disconnect();
    }
  }

  // Create new streamer with updated token
  streamer = createStreamer(currentToken);
  streamer.connect();
});

// ─── Periodic flush timer ───────────────────────────────────────────
const flushTimer = setInterval(() => {
  flushBuffer();
}, flushIntervalSec * 1000);

// ─── Periodic stats timer ───────────────────────────────────────────
const statsTimer = setInterval(() => {
  logStats();
}, statsIntervalSec * 1000);

// ─── Graceful shutdown ──────────────────────────────────────────────
function shutdown(reason) {
  clearInterval(flushTimer);
  clearInterval(statsTimer);
  flushBuffer(); // Final flush

  const uptimeMin = Math.round((Date.now() - startTime) / 1000 / 60);
  const filePath = getOutputFilePath();
  const fileSizeMB = getFileSizeMB(filePath);

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║  Shutdown: ${reason}`.padEnd(64) + `║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║  Uptime:       ${uptimeMin} minutes`.padEnd(64) + `║`);
  console.log(`║  Total ticks:  ${tickCount}`.padEnd(64) + `║`);
  console.log(`║  Written:      ${totalFlushed} ticks`.padEnd(64) + `║`);
  console.log(`║  Today's file: ${fileSizeMB} MB`.padEnd(64) + `║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

  streamer.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Keep process alive — no duration timeout, runs indefinitely
process.on("uncaughtException", (err) => {
  console.error(`  ❌ [${getTimeIST()}] Uncaught exception: ${err.message}`);
  console.error(err.stack);
  // Don't exit — let reconnection handle transient errors
});

process.on("unhandledRejection", (reason) => {
  console.error(`  ❌ [${getTimeIST()}] Unhandled rejection:`, reason);
});
