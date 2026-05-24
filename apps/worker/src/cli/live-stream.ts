import "../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { mkdirSync, appendFileSync, statSync } from "fs";
import BaseScript from "./base-script.ts";
import { nowMs, nowISO, todayDate } from "../utils/time.ts";
import TradingConfig from "../config/trading-config.ts";
import PaytmMoneyWebSocket from "../data/providers/paytm-money-websocket.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
      this.buffer.push({ ...data, received_at: nowISO() });
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

  private getOutputFilePath(): string {
    return resolve(this.dataDir, `${this.config.exchangeType}_${this.config.scripId}_${this.getDateIST()}.ndjson`);
  }

  private getFileSizeMB(filePath: string): string {
    try { return (statSync(filePath).size / (1024 * 1024)).toFixed(2); }
    catch { return "0.00"; }
  }
}

new LiveStreamScript().start();
