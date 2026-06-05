import { resolve } from "path";
import { appendFileSync, readdirSync, unlinkSync, mkdirSync, statSync } from "fs";
import { execSync } from "child_process";
import { createReadStream } from "fs";
import moment from "moment";
// @ts-ignore — installed on server
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { StockConfig } from "../../types/stocks/stock-config.ts";
import { Logger } from "../../types/logger.ts";

const R2_ENDPOINT = process.env.R2_ENDPOINT || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "";

export default class TickBuffer {
  private ticksDir: string;
  private totalFlushed = 0;
  private totalFlushedToday = 0;
  private tickCount = 0;
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
  ) {
    this.ticksDir = resolve(process.cwd(), "..", "..", "data", "ticks");
    mkdirSync(this.ticksDir, { recursive: true });
  }

  push(tick: Record<string, unknown>, instrumentKey: string): void {
    const stock = this.instrumentByKey.get(instrumentKey);
    if (!stock) return;

    const date = this.getDateIST();
    const filePath = this.getFilePath(stock, date);
    appendFileSync(filePath, JSON.stringify(tick) + "\n");
    this.tickCount++;
  }

  flushToR2(): void {
    const date = this.getDateIST();
    const files = readdirSync(this.ticksDir).filter((f) => f.endsWith(".ndjson") && f.includes(date));

    if (files.length === 0) {
      this.log.info("No tick files to flush");
      return;
    }

    this.log.info(`Archiving ${files.length} tick files...`);

    const archivePath = resolve(this.ticksDir, `${date}.tar.gz`);
    execSync(`tar czf ${archivePath} -C ${this.ticksDir} ${files.join(" ")}`, { timeout: 300_000 });

    const archiveSize = statSync(archivePath).size;
    this.log.info(`Archive created: ${(archiveSize / 1024 / 1024).toFixed(1)} MB`);

    const key = `${date}.tar.gz`;

    this.s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: createReadStream(archivePath),
      ContentLength: archiveSize,
      ContentType: "application/gzip",
    })).then(() => {
      unlinkSync(archivePath);
      this.log.info(`Uploaded to R2: ${key}`);
    }).catch((err: Error) => {
      this.log.error(`R2 upload failed for ${key}`, err);
    });

    this.totalFlushed += this.tickCount;
    this.totalFlushedToday = this.tickCount;
    this.log.info(`Flushed ${files.length} files (${this.tickCount} ticks) to R2 as ${key}`);
  }

  cleanupOldFiles(): void {
    const keepDates = new Set<string>();
    for (let i = 0; i < 7; i++) {
      keepDates.add(moment().utcOffset("+05:30").subtract(i, "days").format("YYYY-MM-DD"));
    }

    for (const fileName of readdirSync(this.ticksDir)) {
      if (!fileName.endsWith(".ndjson")) continue;
      const match = fileName.match(/_(\d{4}-\d{2}-\d{2})\.ndjson$/);
      if (!match) continue;
      if (keepDates.has(match[1])) continue;
      try {
        unlinkSync(resolve(this.ticksDir, fileName));
        this.log.info(`Cleaned up old tick file: ${fileName}`);
      } catch {}
    }
  }

  resetDailyCount(): void {
    this.tickCount = 0;
    this.totalFlushedToday = 0;
  }

  getStats() {
    const rawSizeMB = this.getTodayRawSize() / (1024 * 1024);
    return {
      totalFlushed: this.totalFlushed,
      totalFlushedToday: this.totalFlushedToday,
      ticksToday: this.tickCount,
      rawSizeMB,
      estimatedCompressedMB: rawSizeMB * 0.07,
    };
  }

  private getTodayRawSize(): number {
    const date = this.getDateIST();
    let total = 0;
    for (const fileName of readdirSync(this.ticksDir)) {
      if (!fileName.endsWith(".ndjson") || !fileName.includes(date)) continue;
      try {
        total += statSync(resolve(this.ticksDir, fileName)).size;
      } catch {}
    }
    return total;
  }

  private getFilePath(stock: StockConfig, date: string): string {
    return resolve(this.ticksDir, `${stock.exchange}_${this.getScripId(stock)}_${date}.ndjson`);
  }
}
