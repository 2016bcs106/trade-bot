import "../config/env.ts";
import { dirname, resolve } from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { mkdirSync, appendFileSync, readdirSync, unlinkSync } from "fs";
import { createServer } from "https";
import { WebSocketServer, WebSocket } from "ws";
import moment from "moment";
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

interface TrackedStock {
  symbol: string;
  displayName: string;
  exchangeType: string;
  scripId: number;
  scripType: string;
}


class LiveStreamScript extends BaseScript {
  private config = new TradingConfig();
  private dataDir = resolve(__dirname, "..", "..", "..", "..", "data");
  private bufferByInstrument = new Map<string, Record<string, unknown>[]>();
  private totalFlushed = 0;
  private totalFlushedToday = 0;
  private lastFlushDate = this.getDateIST();
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
  private wsDayTracker = this.getDateIST();
  private subscribedClients = new Set<WebSocket>();
  private trackedStocks: TrackedStock[] = [];
  private instrumentByKey = new Map<string, TrackedStock>();
  private instrumentBySecurityId = new Map<number, TrackedStock>();

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
    mkdirSync(this.dataDir, { recursive: true });
    this.cleanupOldDataFiles();
    this.startLocalBroadcastWebSocket();

    const { flushInterval, statsInterval } = this.config;

    this.log.info("Starting live market data recorder");
    this.log.info(`Output directory: ${this.dataDir}`);

    // Load stocks from Firebase and listen for changes
    this.firebase.onStocksChange((stocks) => {
      const enabled = stocks
        ? Object.values(stocks).filter((s) => s.enabled && s.securityId)
        : [];

      this.trackedStocks = enabled.map((s) => this.toTrackedStock(s));
      this.initializeInstrumentMaps();

      this.log.info(`Stocks updated — tracking ${this.trackedStocks.length}: ${this.trackedStocks.map((s) => s.symbol).join(", ")}`);

      // Reconnect WebSocket with new subscriptions
      if (this.currentToken && this.streamer) {
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
        this.flushBuffer();
        if (this.streamer) this.streamer.disconnect();
      }

      this.streamer = this.createStreamer(this.currentToken);
      this.streamer.connect();
    });

    // Timers
    setInterval(() => this.flushBuffer(), flushInterval * 1000);
    setInterval(() => this.logStats(), statsInterval * 1000);

    // Keep process alive
    await new Promise(() => {});
  }

  private toTrackedStock(s: StockConfig): TrackedStock {
    return {
      symbol: s.symbol,
      displayName: s.name,
      exchangeType: s.exchange,
      scripId: typeof s.securityId === "string" ? parseInt(s.securityId, 10) : s.securityId,
      scripType: "EQUITY",
    };
  }

  private createStreamer(token: string): PaytmMoneyWebSocket {
    const { modeType } = this.config;
    const maxBufferSize = this.config.bufferSize;
    const s = new PaytmMoneyWebSocket(token);

    s.on("connected", () => {
      this.log.info(`WebSocket connected — subscribing to ${this.trackedStocks.length} stocks`);
      s.subscribe(this.trackedStocks.map((c) => ({
        scripType: c.scripType,
        exchangeType: c.exchangeType,
        scripId: String(c.scripId),
        modeType,
      })));
    });

    s.on("tick", (data: Record<string, unknown>) => {
      this.tickCount++;
      const tick = { ...data, received_at: nowISO() };
      this.pushTickToInstrumentBuffer(tick);
      this.publishTickToLocalWebSocket(tick);
      if (this.getTotalBufferedTicks() >= maxBufferSize) this.flushBuffer();
    });

    s.on("error", (err: Error) => this.log.error("WebSocket error", err));
    s.on("disconnected", ({ code }: { code: number }) => { this.flushBuffer(); this.log.warn(`WebSocket disconnected — code=${code}`); });
    s.on("reconnecting", (n: number) => this.log.info(`WebSocket reconnecting — attempt ${n}`));

    return s;
  }

  private flushBuffer(): void {
    if (this.getTotalBufferedTicks() === 0) return;

    const today = this.getDateIST();
    if (today !== this.lastFlushDate) {
      this.log.info(`New trading day: ${today}`);
      this.totalFlushedToday = 0;
      this.lastFlushDate = today;
      this.resetMinuteAggregatesForNewDay(today);
      this.cleanupOldDataFiles();
    }

    try {
      let flushedCount = 0;
      for (const [instrumentKey, ticks] of this.bufferByInstrument.entries()) {
        if (ticks.length === 0) continue;
        const stock = this.instrumentByKey.get(instrumentKey);
        if (!stock) continue;
        const filePath = this.getOutputFilePath(stock);
        const lines = ticks.map((tick) => JSON.stringify(tick)).join("\n") + "\n";
        appendFileSync(filePath, lines);
        flushedCount += ticks.length;
      }

      this.totalFlushed += flushedCount;
      this.totalFlushedToday += flushedCount;
      this.bufferByInstrument.clear();
      this.log.info(`Flushed ${flushedCount} ticks — total=${this.totalFlushed}`);
    } catch (err) {
      this.log.error("Flush error", err);
    }
  }

  private logStats(): void {
    const uptimeMin = Math.round((nowMs() - this.startTime) / 1000 / 60);
    const statsInterval = this.config.statsInterval;
    const ticksPerSec = ((this.tickCount - this.tickCountAtLastStats) / statsInterval).toFixed(1);
    const memUsageMB = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);

    this.log.info(
      `Stats — uptime=${uptimeMin}m ticks=${this.tickCount} today=${this.totalFlushedToday} ` +
      `rate=${ticksPerSec}/s buffer=${this.getTotalBufferedTicks()} tracked=${this.minuteAggregatesByInstrument.size} mem=${memUsageMB}MB`,
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
        socket.destroy();
        return;
      }

      this.wsServer.handleUpgrade(request, socket, head, (ws) => {
        this.wsServer.emit("connection", ws, request);
      });
    });

    this.wsServer.on("connection", (client) => {
      this.sendStockList(client);

      client.on("message", (raw) => {
        this.handleClientMessage(client, raw.toString());
      });

      client.on("close", () => {
        this.subscribedClients.delete(client);
      });
    });

    this.wsHttpServer.listen(this.wsPort, () => {
      this.log.info(`Local broadcast websocket listening on wss://0.0.0.0:${this.wsPort}${this.wsPath}`);
    });
  }

  private publishTickToLocalWebSocket(tick: Record<string, unknown>): void {
    this.ensureMinuteAggregationDaySync();

    const aggregate = this.upsertMinuteAggregate(tick);
    if (!aggregate) return;

    this.broadcastToSubscribedClients(aggregate.instrumentKey, {
      type: "minute_update",
      data: aggregate,
      meta: { instrumentKey: aggregate.instrumentKey },
    });
  }

  private ensureMinuteAggregationDaySync(): void {
    const today = this.getDateIST();
    if (today === this.wsDayTracker) return;
    this.wsDayTracker = today;
    this.resetMinuteAggregatesForNewDay(today);
  }

  private resetMinuteAggregatesForNewDay(dateIst: string): void {
    this.minuteAggregatesByInstrument.clear();
    this.broadcastToAllClients({
      type: "day_reset",
      data: {
        dateIst,
        reason: "IST day changed; cleared in-memory minute aggregates",
      },
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
        displayName: stock.displayName,
        exchangeType: stock.exchangeType,
        scripType: stock.scripType,
        scripId: stock.scripId,
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

  private broadcastToSubscribedClients(_instrumentKey: string, payload: Record<string, unknown>): void {
    const message = JSON.stringify(payload);
    for (const client of this.subscribedClients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(message);
    }
  }

  private sendStockList(client: WebSocket): void {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify({
      type: "stock_list",
      data: this.trackedStocks.map((stock) => ({
        instrumentKey: this.getInstrumentKey(stock),
        symbol: stock.symbol,
        displayName: stock.displayName,
        exchangeType: stock.exchangeType,
        scripType: stock.scripType,
        scripId: stock.scripId,
      })),
    }));
  }

  private handleClientMessage(client: WebSocket, raw: string): void {
    try {
      const msg = JSON.parse(raw) as { type?: string };
      if (msg.type !== "subscribe_all") return;

      this.subscribedClients.add(client);
      for (const key of this.instrumentByKey.keys()) {
        this.sendMinuteSnapshot(client, key);
      }
    } catch {
      // ignore invalid client payload
    }
  }

  private getInstrumentKey(stock: TrackedStock): string {
    return `${stock.exchangeType}:${stock.scripType}:${stock.scripId}`;
  }

  private initializeInstrumentMaps(): void {
    this.instrumentByKey.clear();
    this.instrumentBySecurityId.clear();
    for (const stock of this.trackedStocks) {
      const key = this.getInstrumentKey(stock);
      this.instrumentByKey.set(key, stock);
      this.instrumentBySecurityId.set(stock.scripId, stock);
    }
  }

  private resolveStockFromTick(tick: Record<string, unknown>): TrackedStock | null {
    const securityId = Number(tick.security_id);
    if (!Number.isFinite(securityId)) return null;
    return this.instrumentBySecurityId.get(securityId) ?? null;
  }

  private pushTickToInstrumentBuffer(tick: Record<string, unknown>): void {
    const stock = this.resolveStockFromTick(tick);
    if (!stock) return;
    const key = this.getInstrumentKey(stock);
    const list = this.bufferByInstrument.get(key) ?? [];
    list.push(tick);
    this.bufferByInstrument.set(key, list);
  }

  private getTotalBufferedTicks(): number {
    let total = 0;
    for (const arr of this.bufferByInstrument.values()) total += arr.length;
    return total;
  }

  private getOutputFilePath(stock: TrackedStock): string {
    return resolve(this.dataDir, `${stock.exchangeType}_${stock.scripId}_${this.getDateIST()}.ndjson`);
  }

  private cleanupOldDataFiles(): void {
    const keepDates = new Set([
      moment().utcOffset("+05:30").format("YYYY-MM-DD"),
      moment().utcOffset("+05:30").subtract(1, "day").format("YYYY-MM-DD"),
      moment().utcOffset("+05:30").subtract(2, "day").format("YYYY-MM-DD"),
    ]);

    for (const fileName of readdirSync(this.dataDir)) {
      if (!fileName.endsWith(".ndjson")) continue;
      const match = fileName.match(/_(\d{4}-\d{2}-\d{2})\.ndjson$/);
      if (!match) continue;
      const fileDate = match[1];
      if (keepDates.has(fileDate)) continue;
      try {
        unlinkSync(resolve(this.dataDir, fileName));
      } catch {
        // ignore cleanup failures for individual files
      }
    }
  }

}

new LiveStreamScript().start();
