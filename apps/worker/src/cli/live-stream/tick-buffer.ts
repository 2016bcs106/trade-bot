import { gzipSync } from "zlib";
import moment from "moment";
// @ts-ignore — installed on server
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { StockConfig } from "../../types/stocks/stock-config.ts";
import { Logger } from "../../types/logger.ts";

const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "";
const MEMORY_THRESHOLD_BYTES = 100 * 1024 * 1024;
const FLUSH_TOP_PERCENT = 0.1;

export default class TickBuffer {
  private bufferByInstrument = new Map<string, Record<string, unknown>[]>();
  private bufferBytesByInstrument = new Map<string, number>();
  private bufferBytesTotal = 0;
  private totalFlushed = 0;
  private totalFlushedToday = 0;
  private lastFlushDate: string;
  private s3 = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });

  constructor(
    private log: Logger,
    private getDateIST: () => string,
    private getScripId: (stock: StockConfig) => number,
    private instrumentByKey: Map<string, StockConfig>,
    private getMarketStatus: () => string,
    private onCleanup: () => void,
  ) {
    this.lastFlushDate = getDateIST();
  }

  push(tick: Record<string, unknown>, instrumentKey: string): void {
    const list = this.bufferByInstrument.get(instrumentKey) ?? [];
    const bytes = JSON.stringify(tick).length;
    list.push(tick);
    this.bufferByInstrument.set(instrumentKey, list);
    this.bufferBytesTotal += bytes;
    this.bufferBytesByInstrument.set(instrumentKey, (this.bufferBytesByInstrument.get(instrumentKey) ?? 0) + bytes);
  }

  flush(force = false): void {
    if (this.getTotalTicks() === 0) return;

    if (!force && this.getMarketStatus() === "Closed") {
      this.log.info(`Discarding ${this.getTotalTicks()} off-market ticks`);
      this.clear();
      return;
    }

    if (!force && this.bufferBytesTotal < MEMORY_THRESHOLD_BYTES) return;

    const today = this.getDateIST();
    if (today !== this.lastFlushDate) {
      this.log.info(`New trading day: ${today}`);
      this.totalFlushedToday = 0;
      this.lastFlushDate = today;
      this.onCleanup();
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

  getTotalTicks(): number {
    let total = 0;
    for (const arr of this.bufferByInstrument.values()) total += arr.length;
    return total;
  }

  getStats() {
    return {
      totalFlushed: this.totalFlushed,
      totalFlushedToday: this.totalFlushedToday,
      bufferSize: this.getTotalTicks(),
      bufferMB: this.bufferBytesTotal / 1024 / 1024,
    };
  }

  private clear(): void {
    this.bufferByInstrument.clear();
    this.bufferBytesByInstrument.clear();
    this.bufferBytesTotal = 0;
  }
}
