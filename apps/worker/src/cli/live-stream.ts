import "../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, appendFileSync, statSync } from "fs";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import moment from "moment";
import BaseScript from "./base-script.ts";
import { nowMs, nowISO, todayDate } from "../utils/time.ts";
import TradingConfig from "../config/trading-config.ts";
import PaytmMoneyWebSocket from "../data/providers/paytm-money-websocket.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface MinuteAggregatePayload {
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

class LiveStreamScript extends BaseScript {
  private config = new TradingConfig("live-stream");
  private dataDir = resolve(__dirname, "..", "..", "..", "..", "data");
  private buffer: Record<string, unknown>[] = [];
  private totalFlushed = 0;
  private totalFlushedToday = 0;
  private lastFlushDate = this.getDateIST();
  private tickCount = 0;
  private tickCountAtLastStats = 0;
  private startTime = nowMs();
  private currentToken: string | null = null;
  private streamer: PaytmMoneyWebSocket | null = null;
  private wsHttpServer = createServer();
  private wsServer = new WebSocketServer({ noServer: true });
  private wsPort = 8081;
  private wsPath = "/live-ticks";
  private minuteAggregates = new Map<string, MinuteAggregatePayload>();
  private wsDayTracker = this.getDateIST();

  get scriptName(): string {
    return "live-stream";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      tickCount: this.tickCount,
      totalFlushed: this.totalFlushed,
      totalFlushedToday: this.totalFlushedToday,
      bufferSize: this.buffer.length,
      uptimeMinutes: Math.round((nowMs() - this.startTime) / 1000 / 60),
      outputFile: this.getOutputFilePath(),
      fileSizeMB: this.getFileSizeMB(this.getOutputFilePath()),
      config: this.config.toJSON(),
    };
  }

  protected async run(): Promise<void> {
    mkdirSync(this.dataDir, { recursive: true });
    this.startLocalBroadcastWebSocket();

    const { scripId, scripType, exchangeType, modeType, flushInterval, bufferSize, statsInterval } = this.config;

    this.log.info("Starting live market data recorder");
    this.log.info(`Config — scrip=${exchangeType}:${scripId}(${scripType}) mode=${modeType} flush=${flushInterval}s buffer=${bufferSize} stats=${statsInterval}s`);
    this.log.info(`Output directory: ${this.dataDir}`);

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
    setInterval(() => this.flushBuffer(), flushInterval! * 1000);
    setInterval(() => this.logStats(), statsInterval! * 1000);

    // Keep process alive
    await new Promise(() => {});
  }

  private createStreamer(token: string): PaytmMoneyWebSocket {
    const { scripId, scripType, exchangeType, modeType } = this.config;
    const maxBufferSize = this.config.bufferSize!;
    const s = new PaytmMoneyWebSocket(token);

    s.on("connected", () => {
      this.log.info("WebSocket connected");
      s.subscribe({ scripType, exchangeType, scripId, modeType: modeType! });
    });

    s.on("tick", (data: Record<string, unknown>) => {
      this.tickCount++;
      const tick = { ...data, received_at: nowISO() };
      this.buffer.push(tick);
      this.publishTickToLocalWebSocket(tick);
      if (this.buffer.length >= maxBufferSize) this.flushBuffer();
    });

    s.on("error", (err: Error) => this.log.error("WebSocket error", err));
    s.on("disconnected", ({ code }: { code: number }) => { this.flushBuffer(); this.log.warn(`WebSocket disconnected — code=${code}`); });
    s.on("reconnecting", (n: number) => this.log.info(`WebSocket reconnecting — attempt ${n}`));

    return s;
  }

  private flushBuffer(): void {
    if (this.buffer.length === 0) return;

    const today = this.getDateIST();
    if (today !== this.lastFlushDate) {
      this.log.info(`New trading day: ${today}`);
      this.totalFlushedToday = 0;
      this.lastFlushDate = today;
      this.resetMinuteAggregatesForNewDay(today);
    }

    const filePath = this.getOutputFilePath();
    const lines = this.buffer.map((tick) => JSON.stringify(tick)).join("\n") + "\n";

    try {
      const flushedCount = this.buffer.length;
      appendFileSync(filePath, lines);
      this.totalFlushed += flushedCount;
      this.totalFlushedToday += flushedCount;
      this.buffer = [];
      this.log.info(`Flushed ${flushedCount} ticks — file=${this.getFileSizeMB(filePath)}MB total=${this.totalFlushed}`);
    } catch (err) {
      this.log.error("Flush error", err);
    }
  }

  private logStats(): void {
    const uptimeMin = Math.round((nowMs() - this.startTime) / 1000 / 60);
    const statsInterval = this.config.statsInterval!;
    const ticksPerSec = ((this.tickCount - this.tickCountAtLastStats) / statsInterval).toFixed(1);
    const memUsageMB = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);

    this.log.info(
      `Stats — uptime=${uptimeMin}m ticks=${this.tickCount} today=${this.totalFlushedToday} ` +
      `rate=${ticksPerSec}/s buffer=${this.buffer.length} file=${this.getFileSizeMB(this.getOutputFilePath())}MB mem=${memUsageMB}MB`,
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
      this.sendMinuteSnapshot(client);
    });

    this.wsHttpServer.listen(this.wsPort, () => {
      this.log.info(`Local broadcast websocket listening on ws://localhost:${this.wsPort}${this.wsPath}`);
    });
  }

  private publishTickToLocalWebSocket(tick: Record<string, unknown>): void {
    this.ensureMinuteAggregationDaySync();

    const aggregate = this.upsertMinuteAggregate(tick);
    if (!aggregate) return;

    this.broadcastToAllClients({
      type: "minute_update",
      data: aggregate,
    });
  }

  private ensureMinuteAggregationDaySync(): void {
    const today = this.getDateIST();
    if (today === this.wsDayTracker) return;
    this.wsDayTracker = today;
    this.resetMinuteAggregatesForNewDay(today);
  }

  private resetMinuteAggregatesForNewDay(dateIst: string): void {
    this.minuteAggregates.clear();
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

    const receivedAt = String(tick.received_at ?? nowISO());
    const minuteKey = moment(receivedAt).utcOffset("+05:30").format("YYYY-MM-DDTHH:mm");
    const dateIst = minuteKey.slice(0, 10);

    const buyQtyRaw = Number(tick.total_buy_quantity);
    const sellQtyRaw = Number(tick.total_sell_quantity);
    const buyQty = Number.isFinite(buyQtyRaw) ? buyQtyRaw : 0;
    const sellQty = Number.isFinite(sellQtyRaw) ? sellQtyRaw : 0;

    const existing = this.minuteAggregates.get(minuteKey);
    if (!existing) {
      const first: MinuteAggregatePayload = {
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
      this.minuteAggregates.set(minuteKey, first);
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

  private getMinuteSnapshotData(): MinuteAggregatePayload[] {
    return Array.from(this.minuteAggregates.values()).sort((a, b) => a.minute.localeCompare(b.minute));
  }

  private sendMinuteSnapshot(client: WebSocket): void {
    if (client.readyState !== WebSocket.OPEN) return;
    const snapshot = this.getMinuteSnapshotData();
    client.send(JSON.stringify({
      type: "snapshot",
      data: snapshot,
      meta: { count: snapshot.length, asOf: nowISO() },
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

  private getOutputFilePath(): string {
    return resolve(this.dataDir, `${this.config.exchangeType}_${this.config.scripId}_${this.getDateIST()}.ndjson`);
  }

  private getFileSizeMB(filePath: string): string {
    try { return (statSync(filePath).size / (1024 * 1024)).toFixed(2); }
    catch { return "0.00"; }
  }
}

new LiveStreamScript().start();
