import "../config/env.ts";
import { dirname, resolve } from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { mkdirSync, readdirSync, unlinkSync, readFileSync, existsSync, writeFileSync } from "fs";
import { gzipSync } from "zlib";
import { createServer } from "https";
import { WebSocketServer, WebSocket } from "ws";
import moment from "moment";
// @ts-ignore — installed on server
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import BaseScript from "./base-script.ts";
import { nowMs, nowISO, todayDate } from "../utils/time.ts";
import TradingConfig from "../config/trading-config.ts";
import PaytmMoneyWebSocket from "../data/providers/paytm-money-websocket.ts";
import { StockConfig } from "../types/stocks/stock-config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface MinuteAggregatePayload {
  instrumentKey: string;
  symbol: string;
  displayName: string;
  exchangeType: string;
  scripType: string;
  scripId: number;
  minute: string;
  dateIst: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickCount: number;
  buyQtySum: number;
  sellQtySum: number;
  buySellRatio: number | null;
  lastUpdatedAt: string;
}



const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "";
const MEMORY_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MB
const FLUSH_TOP_PERCENT = 0.1; // flush top 10%

class LiveStreamScript extends BaseScript {
  private config = new TradingConfig();
  private dataDir = resolve(__dirname, "..", "..", "..", "..", "data");
  private aggregatesDir = resolve(this.dataDir, "aggregates");
  private bufferByInstrument = new Map<string, Record<string, unknown>[]>();
  private bufferBytesTotal = 0;
  private bufferBytesByInstrument = new Map<string, number>();
  private totalFlushed = 0;
  private totalFlushedToday = 0;
  private lastFlushDate = this.getDateIST();
  private s3 = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  private tickCount = 0;
  private tickCountAtLastStats = 0;
  private startTime = nowMs();
  private currentToken: string | null = null;
  private streamer: PaytmMoneyWebSocket | null = null;
  private wsHttpServer = createServer({
    cert: fs.readFileSync("/etc/letsencrypt/live/trade-bot-ws.duckdns.org/fullchain.pem"),
    key: fs.readFileSync("/etc/letsencrypt/live/trade-bot-ws.duckdns.org/privkey.pem"),
  });
  private wsServer = new WebSocketServer({ noServer: true });
  private wsPort = 8081;
  private wsPath = "/live-ticks";
  private minuteAggregatesByInstrument = new Map<string, Map<string, MinuteAggregatePayload>>();
  private trackedStocks: StockConfig[] = [];
  private instrumentByKey = new Map<string, StockConfig>();
  private instrumentBySecurityId = new Map<number, StockConfig>();
  private relevanceScores = new Map<string, number>();
  private marketStatus: string = "Closed";
  private lastTradeDate: string | null = null;

  get scriptName(): string {
    return "live-stream";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      tickCount: this.tickCount,
      totalFlushed: this.totalFlushed,
      totalFlushedToday: this.totalFlushedToday,
      bufferSize: Array.from(this.bufferByInstrument.values()).reduce((sum, arr) => sum + arr.length, 0),
      uptimeMinutes: Math.round((nowMs() - this.startTime) / 1000 / 60),
      trackedStocks: this.trackedStocks.length,
      config: this.config.toJSON(),
    };
  }

  protected async run(): Promise<void> {
    mkdirSync(this.aggregatesDir, { recursive: true });
    this.cleanupOldAggregateFiles();
    this.startLocalBroadcastWebSocket();

    const { statsInterval } = this.config;

    this.log.info("Starting live market data recorder");
    this.log.info(`Output directory: ${this.dataDir}`);

    // Load stocks from Firebase and listen for changes
    this.firebase.onStocksChange((stocks) => {
      const active = stocks
        ? Object.values(stocks).filter((s) => s.securityId)
        : [];

      this.trackedStocks = active;
      this.initializeInstrumentMaps();
      if (this.lastTradeDate) {
        this.loadHistoricalData();
        this.broadcastAllSnapshots();
      }

      this.log.info(`Stocks updated — tracking ${this.trackedStocks.length}: ${this.trackedStocks.map((s) => s.symbol).join(", ")}`);

      // Broadcast updated stock list to all connected clients
      for (const client of this.wsServer.clients) {
        this.sendStockList(client);
      }

      // Reconnect data streamer with new subscriptions (only during market hours)
      if (this.currentToken && this.streamer && this.marketStatus !== "Closed") {
        this.streamer.disconnect();
        this.streamer = this.createStreamer(this.currentToken);
        this.streamer.connect();
      }
    });

    // Listen to token changes and connect
    this.firebase.onPublicAccessTokenChange((token: string) => {
      const isFirstConnect = this.currentToken === null;
      this.currentToken = token;

      if (isFirstConnect) {
        this.log.info("Public access token loaded from Firebase");
      } else {
        this.log.info("Public access token updated — reconnecting WebSocket");
        this.flushToR2(true);
        if (this.streamer) this.streamer.disconnect();
      }

      if (this.marketStatus !== "Closed") {
        this.streamer = this.createStreamer(this.currentToken);
        this.streamer.connect();
      }
    });

    // Listen to market status changes
    this.firebase.onMarketStatusChange((data) => {
      if (!data) return;
      const prevStatus = this.marketStatus;
      const prevTradeDate = this.lastTradeDate;
      this.marketStatus = data.status;
      this.lastTradeDate = data.tradeDate;

      this.log.info(`Market status: ${data.status} | tradeDate=${data.tradeDate}`);
      this.broadcastToAllClients({ type: "market_status", data: { status: data.status, tradeDate: data.tradeDate } });

      if (!prevTradeDate && data.tradeDate && this.trackedStocks.length > 0) {
        this.minuteAggregatesByInstrument.clear();
        this.loadHistoricalData();
        this.broadcastAllSnapshots();
      }

      if (data.status === "Closed" && prevStatus !== "Closed") {
        this.log.info("Market closed — final flush and disconnecting streamer");
        this.flushToR2(true);
        this.saveAggregates();
        if (this.streamer) { this.streamer.disconnect(); this.streamer = null; }
      } else if (data.status !== "Closed" && prevStatus === "Closed") {
        this.log.info("Market opened — clearing aggregates and connecting streamer");
        this.minuteAggregatesByInstrument.clear();
        this.broadcastToAllClients({ type: "day_reset", data: { reason: "market opened" } });
        if (this.currentToken) {
          this.streamer = this.createStreamer(this.currentToken);
          this.streamer.connect();
        }
      }
    });

    // Timers
    setInterval(() => this.flushToR2(), 10_000);
    setInterval(() => this.saveAggregates(), 60_000);
    setInterval(() => this.logStats(), statsInterval * 1000);
    setInterval(() => this.publishStockList(), 60_000);

    // Keep process alive
    await new Promise(() => {});
  }

  private getScripId(stock: StockConfig): number {
    return typeof stock.securityId === "string" ? parseInt(stock.securityId, 10) : stock.securityId;
  }

  private createStreamer(token: string): PaytmMoneyWebSocket {
    const { modeType } = this.config;
    const s = new PaytmMoneyWebSocket(token);

    s.on("connected", () => {
      this.log.info(`WebSocket connected — subscribing to ${this.trackedStocks.length} stocks`);
      s.subscribe(this.trackedStocks.map((c) => ({
        scripType: "EQUITY",
        exchangeType: c.exchange,
        scripId: String(this.getScripId(c)),
        modeType,
      })));
    });

    s.on("tick", (data: Record<string, unknown>) => {
      if (this.marketStatus === "Closed") return;
      this.tickCount++;
      const tick = { ...data, received_at: nowISO() };
      this.pushTickToInstrumentBuffer(tick);
      this.publishTickToLocalWebSocket(tick);
    });

    s.on("error", (err: Error) => this.log.error("WebSocket error", err));
    s.on("disconnected", ({ code }: { code: number }) => { this.flushToR2(true); this.log.warn(`WebSocket disconnected — code=${code}`); });
    s.on("reconnecting", (n: number) => this.log.info(`WebSocket reconnecting — attempt ${n}`));

    return s;
  }

  private flushToR2(force = false): void {
    if (this.getTotalBufferedTicks() === 0) return;

    if (!force && this.marketStatus === "Closed") {
      this.log.info(`Discarding ${this.getTotalBufferedTicks()} off-market ticks`);
      this.bufferByInstrument.clear();
      this.bufferBytesByInstrument.clear();
      this.bufferBytesTotal = 0;
      return;
    }

    if (!force && this.bufferBytesTotal < MEMORY_THRESHOLD_BYTES) return;

    const today = this.getDateIST();
    if (today !== this.lastFlushDate) {
      this.log.info(`New trading day: ${today}`);
      this.totalFlushedToday = 0;
      this.lastFlushDate = today;
      this.cleanupOldAggregateFiles();
    }

    const entries = Array.from(this.bufferBytesByInstrument.entries())
      .filter(([key]) => (this.bufferByInstrument.get(key)?.length ?? 0) > 0)
      .sort((a, b) => b[1] - a[1]);

    const count = force ? entries.length : Math.max(1, Math.ceil(entries.length * FLUSH_TOP_PERCENT));
    const toFlush = entries.slice(0, count);
    const timestamp = moment().utcOffset("+05:30").format("HH-mm-ss");

    let flushedCount = 0;
    let flushedBytes = 0;
    for (const [instrumentKey] of toFlush) {
      const ticks = this.bufferByInstrument.get(instrumentKey);
      if (!ticks || ticks.length === 0) continue;
      const stock = this.instrumentByKey.get(instrumentKey);
      if (!stock) continue;

      const lines = ticks.map((tick) => JSON.stringify(tick)).join("\n") + "\n";
      const compressed = gzipSync(Buffer.from(lines), { level: 9 });
      const key = `${today}/${stock.exchange}_${this.getScripId(stock)}/${timestamp}.ndjson.gz`;

      this.s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: compressed,
        ContentType: "application/gzip",
      })).catch((err: Error) => this.log.error(`R2 upload failed for ${key}`, err));

      flushedCount += ticks.length;
      const instrumentBytes = this.bufferBytesByInstrument.get(instrumentKey) ?? 0;
      flushedBytes += instrumentBytes;
      this.bufferByInstrument.set(instrumentKey, []);
      this.bufferBytesByInstrument.set(instrumentKey, 0);
    }

    this.bufferBytesTotal -= flushedBytes;
    this.totalFlushed += flushedCount;
    this.totalFlushedToday += flushedCount;
    this.log.info(`Flushed ${flushedCount} ticks to R2 (${toFlush.length} instruments, ${(flushedBytes / 1024 / 1024).toFixed(1)}MB) — total=${this.totalFlushed}`);
  }

  private saveAggregates(): void {
    if (this.minuteAggregatesByInstrument.size === 0) return;

    let saved = 0;
    for (const [instrumentKey, minuteMap] of this.minuteAggregatesByInstrument.entries()) {
      if (minuteMap.size === 0) continue;
      const stock = this.instrumentByKey.get(instrumentKey);
      if (!stock) continue;

      const data = Array.from(minuteMap.values()).sort((a, b) => a.minute.localeCompare(b.minute));
      const date = data[0].dateIst;
      const filePath = resolve(this.aggregatesDir, `${stock.exchange}_${this.getScripId(stock)}_${date}.json`);
      writeFileSync(filePath, JSON.stringify(data));
      saved++;
    }

    this.log.info(`Saved aggregates for ${saved} instruments`);
  }

  private logStats(): void {
    const uptimeMin = Math.round((nowMs() - this.startTime) / 1000 / 60);
    const statsInterval = this.config.statsInterval;
    const ticksPerSec = ((this.tickCount - this.tickCountAtLastStats) / statsInterval).toFixed(1);
    const memUsageMB = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);
    const wsClients = this.wsServer.clients.size;

    this.log.info(
      `Stats — uptime=${uptimeMin}m ticks=${this.tickCount} today=${this.totalFlushedToday} ` +
      `rate=${ticksPerSec}/s buffer=${this.getTotalBufferedTicks()}/${(this.bufferBytesTotal / 1024 / 1024).toFixed(1)}MB ` +
      `tracked=${this.minuteAggregatesByInstrument.size} clients=${wsClients} mem=${memUsageMB}MB`,
    );

    this.tickCountAtLastStats = this.tickCount;
  }

  private getDateIST(): string {
    return todayDate();
  }

  private startLocalBroadcastWebSocket(): void {
    this.wsHttpServer.on("upgrade", (request, socket, head) => {
      const requestUrl = new URL(request.url ?? "", "http://localhost");
      if (requestUrl.pathname !== this.wsPath) {
        this.log.warn(`Rejected upgrade — path=${requestUrl.pathname} (expected ${this.wsPath})`);
        socket.destroy();
        return;
      }

      this.wsServer.handleUpgrade(request, socket, head, (ws) => {
        this.wsServer.emit("connection", ws, request);
      });
    });

    this.wsHttpServer.on("error", (err) => {
      this.log.error("HTTPS server error", err);
    });

    this.wsServer.on("connection", (client, request) => {
      const ip = request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown";
      const totalClients = this.wsServer.clients.size;
      this.log.info(`Client connected — ip=${ip} clients=${totalClients}`);

      this.sendStockList(client);
      this.sendMarketStatus(client);
      for (const key of this.instrumentByKey.keys()) {
        this.sendMinuteSnapshot(client, key);
      }

      client.on("close", (code, reason) => {
        const remaining = this.wsServer.clients.size;
        this.log.info(`Client disconnected — ip=${ip} code=${code} reason=${reason || "none"} clients=${remaining}`);
      });

      client.on("error", (err) => {
        this.log.warn(`Client error — ip=${ip} error=${err.message}`);
      });
    });

    this.wsHttpServer.listen(this.wsPort, () => {
      this.log.info(`Local broadcast websocket listening on wss://0.0.0.0:${this.wsPort}${this.wsPath}`);
    });
  }

  private publishTickToLocalWebSocket(tick: Record<string, unknown>): void {
    const aggregate = this.upsertMinuteAggregate(tick);
    if (!aggregate) return;

    this.broadcastToAllClients({
      type: "minute_update",
      data: aggregate,
      meta: { instrumentKey: aggregate.instrumentKey },
    });
  }

  private upsertMinuteAggregate(tick: Record<string, unknown>): MinuteAggregatePayload | null {
    const price = Number(tick.last_price);
    if (!Number.isFinite(price)) return null;

    const stock = this.resolveStockFromTick(tick);
    if (!stock) return null;

    const instrumentKey = this.getInstrumentKey(stock);

    const receivedAt = String(tick.received_at ?? nowISO());
    const minuteKey = moment(receivedAt).utcOffset("+05:30").format("YYYY-MM-DDTHH:mm");
    const dateIst = minuteKey.slice(0, 10);

    const buyQtyRaw = Number(tick.total_buy_quantity);
    const sellQtyRaw = Number(tick.total_sell_quantity);
    const buyQty = Number.isFinite(buyQtyRaw) ? buyQtyRaw : 0;
    const sellQty = Number.isFinite(sellQtyRaw) ? sellQtyRaw : 0;

    let perInstrument = this.minuteAggregatesByInstrument.get(instrumentKey);
    if (!perInstrument) {
      perInstrument = new Map<string, MinuteAggregatePayload>();
      this.minuteAggregatesByInstrument.set(instrumentKey, perInstrument);
    }

    const existing = perInstrument.get(minuteKey);
    if (!existing) {
      const first: MinuteAggregatePayload = {
        instrumentKey,
        symbol: stock.symbol,
        displayName: stock.name,
        exchangeType: stock.exchange,
        scripType: "EQUITY",
        scripId: this.getScripId(stock),
        minute: minuteKey,
        dateIst,
        open: price,
        high: price,
        low: price,
        close: price,
        tickCount: 1,
        buyQtySum: buyQty,
        sellQtySum: sellQty,
        buySellRatio: sellQty > 0 ? Number((buyQty / sellQty).toFixed(6)) : null,
        lastUpdatedAt: receivedAt,
      };
      perInstrument.set(minuteKey, first);
      return first;
    }

    existing.high = Math.max(existing.high, price);
    existing.low = Math.min(existing.low, price);
    existing.close = price;
    existing.tickCount += 1;
    existing.buyQtySum += buyQty;
    existing.sellQtySum += sellQty;
    existing.buySellRatio = existing.sellQtySum > 0 ? Number((existing.buyQtySum / existing.sellQtySum).toFixed(6)) : null;
    existing.lastUpdatedAt = receivedAt;

    return existing;
  }

  private getMinuteSnapshotData(instrumentKey: string): MinuteAggregatePayload[] {
    const map = this.minuteAggregatesByInstrument.get(instrumentKey);
    if (!map) return [];
    return Array.from(map.values()).sort((a, b) => a.minute.localeCompare(b.minute));
  }

  private broadcastAllSnapshots(): void {
    for (const client of this.wsServer.clients) {
      for (const key of this.instrumentByKey.keys()) {
        this.sendMinuteSnapshot(client, key);
      }
    }
  }

  private sendMinuteSnapshot(client: WebSocket, instrumentKey: string): void {
    if (client.readyState !== WebSocket.OPEN) return;
    const snapshot = this.getMinuteSnapshotData(instrumentKey);
    client.send(JSON.stringify({
      type: "snapshot",
      data: snapshot,
      meta: { count: snapshot.length, asOf: nowISO(), instrumentKey },
    }));
  }

  private broadcastToAllClients(payload: Record<string, unknown>): void {
    const message = JSON.stringify(payload);
    for (const client of this.wsServer.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }


  private sendMarketStatus(client: WebSocket): void {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify({
      type: "market_status",
      data: { status: this.marketStatus, tradeDate: this.lastTradeDate },
    }));
  }

  private sendStockList(client: WebSocket): void {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify({
      type: "stock_list",
      data: this.trackedStocks.map((stock) => ({
        instrumentKey: this.getInstrumentKey(stock),
        symbol: stock.symbol,
        displayName: stock.name,
        exchangeType: stock.exchange,
        scripType: "EQUITY",
        scripId: this.getScripId(stock),
        isin: stock.isin,
        industryName: stock.industryName,
        mcap: stock.mcap,
        addedAt: stock.addedAt,
        updatedAt: stock.updatedAt,
        status: stock.status,
        relevanceScore: this.relevanceScores.get(stock.symbol) ?? 0,
      })),
    }));
  }

  private computeRelevanceScores(): void {
    for (const stock of this.trackedStocks) {
      const key = this.getInstrumentKey(stock);
      const minuteMap = this.minuteAggregatesByInstrument.get(key);
      if (!minuteMap || minuteMap.size === 0) {
        this.relevanceScores.set(stock.symbol, 0);
        continue;
      }

      const allMinutes = Array.from(minuteMap.values())
        .sort((a, b) => b.minute.localeCompare(a.minute))
        .slice(0, 60);

      const byActivity = allMinutes
        .map((m) => ({ buy: m.buyQtySum, sell: m.sellQtySum, peak: Math.max(m.buyQtySum, m.sellQtySum) }))
        .sort((a, b) => b.peak - a.peak);

      const topHalf = byActivity.slice(0, Math.max(1, Math.ceil(byActivity.length / 2)));

      let sum = 0;
      let count = 0;
      for (const m of topHalf) {
        if (m.peak === 0) continue;
        sum += Math.abs(m.buy - m.sell) / m.peak;
        count++;
      }

      this.relevanceScores.set(stock.symbol, count > 0 ? sum / count : 0);
    }
  }

  private publishStockList(): void {
    if (this.trackedStocks.length === 0) return;
    this.computeRelevanceScores();
    for (const client of this.wsServer.clients) {
      this.sendStockList(client);
    }
  }

  private getInstrumentKey(stock: StockConfig): string {
    return `${stock.exchange}:EQUITY:${this.getScripId(stock)}`;
  }

  private initializeInstrumentMaps(): void {
    this.instrumentByKey.clear();
    this.instrumentBySecurityId.clear();
    for (const stock of this.trackedStocks) {
      const key = this.getInstrumentKey(stock);
      this.instrumentByKey.set(key, stock);
      this.instrumentBySecurityId.set(this.getScripId(stock), stock);
    }
  }

  private resolveStockFromTick(tick: Record<string, unknown>): StockConfig | null {
    const securityId = Number(tick.security_id);
    if (!Number.isFinite(securityId)) return null;
    return this.instrumentBySecurityId.get(securityId) ?? null;
  }

  private pushTickToInstrumentBuffer(tick: Record<string, unknown>): void {
    const stock = this.resolveStockFromTick(tick);
    if (!stock) return;
    const key = this.getInstrumentKey(stock);
    const list = this.bufferByInstrument.get(key) ?? [];
    const bytes = JSON.stringify(tick).length;
    list.push(tick);
    this.bufferByInstrument.set(key, list);
    this.bufferBytesTotal += bytes;
    this.bufferBytesByInstrument.set(key, (this.bufferBytesByInstrument.get(key) ?? 0) + bytes);
  }

  private getTotalBufferedTicks(): number {
    let total = 0;
    for (const arr of this.bufferByInstrument.values()) total += arr.length;
    return total;
  }


  private getTargetDate(): string | null {
    if (this.lastTradeDate) {
      const parsed = moment(this.lastTradeDate, "DD-MMM-YYYY HH:mm").utcOffset("+05:30");
      if (parsed.isValid()) return parsed.format("YYYY-MM-DD");
      const dateOnly = moment(this.lastTradeDate, "DD-MMM-YYYY").utcOffset("+05:30");
      if (dateOnly.isValid()) return dateOnly.format("YYYY-MM-DD");
    }
    return null;
  }

  private loadHistoricalData(): void {
    let totalLoaded = 0;

    if (this.marketStatus !== "Closed") {
      const today = this.getDateIST();
      for (const stock of this.trackedStocks) {
        const instrumentKey = this.getInstrumentKey(stock);
        if (this.minuteAggregatesByInstrument.has(instrumentKey)) continue;
        if (this.loadAggregateFile(stock, today)) totalLoaded++;
      }
    } else {
      const targetDate = this.getTargetDate();
      for (const stock of this.trackedStocks) {
        const instrumentKey = this.getInstrumentKey(stock);
        if (this.minuteAggregatesByInstrument.has(instrumentKey)) continue;
        let loaded = false;

        if (targetDate) {
          loaded = this.loadAggregateFile(stock, targetDate);
        }

        if (!loaded) {
          for (let daysBack = 0; daysBack < 7; daysBack++) {
            const date = moment().utcOffset("+05:30").subtract(daysBack, "days").format("YYYY-MM-DD");
            if (this.loadAggregateFile(stock, date)) { loaded = true; break; }
          }
        }

        if (loaded) totalLoaded++;
      }
    }

    if (totalLoaded > 0) {
      this.log.info(`Historical data loaded for ${totalLoaded} stocks`);
    }
  }

  private loadAggregateFile(stock: StockConfig, date: string): boolean {
    const scripId = this.getScripId(stock);
    const filePath = resolve(this.aggregatesDir, `${stock.exchange}_${scripId}_${date}.json`);
    if (!existsSync(filePath)) return false;

    try {
      const content = readFileSync(filePath, "utf-8");
      const data = JSON.parse(content) as MinuteAggregatePayload[];
      if (!Array.isArray(data) || data.length === 0) return false;

      const instrumentKey = this.getInstrumentKey(stock);
      const minuteMap = new Map<string, MinuteAggregatePayload>();
      for (const entry of data) {
        minuteMap.set(entry.minute, entry);
      }
      this.minuteAggregatesByInstrument.set(instrumentKey, minuteMap);

      this.log.info(`Loaded ${data.length} minutes for ${stock.symbol} from ${date}`);
      return true;
    } catch {
      return false;
    }
  }

  private cleanupOldAggregateFiles(): void {
    const keepDates = new Set<string>();
    for (let i = 0; i < 7; i++) {
      keepDates.add(moment().utcOffset("+05:30").subtract(i, "days").format("YYYY-MM-DD"));
    }

    for (const fileName of readdirSync(this.aggregatesDir)) {
      if (!fileName.endsWith(".json")) continue;
      const match = fileName.match(/_(\d{4}-\d{2}-\d{2})\.json$/);
      if (!match) continue;
      const fileDate = match[1];
      if (keepDates.has(fileDate)) continue;
      try {
        unlinkSync(resolve(this.aggregatesDir, fileName));
        this.log.info(`Cleaned up old aggregate file: ${fileName}`);
      } catch {
        // ignore cleanup failures
      }
    }
  }

}

new LiveStreamScript().start();
