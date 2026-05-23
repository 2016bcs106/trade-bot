import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { OHLCV } from "../../types/market-data/ohlcv.ts";

/**
 * NDJSON (Newline Delimited JSON) storage for OHLCV data.
 * Each line is a valid JSON object — simple, appendable, and streamable.
 *
 * File layout: data/{symbol}/{interval}/{YYYY-MM-DD}.ndjson
 */
export default class NdjsonStorage {
  private readonly baseDir: string;

  constructor(baseDir: string = join(process.cwd(), "data")) {
    this.baseDir = baseDir;
  }

  /**
   * Append OHLCV records to the appropriate date file.
   * Creates directories and file if they don't exist.
   */
  append(symbol: string, interval: string, records: OHLCV[]): void {
    if (records.length === 0) return;

    // Group by date
    const byDate = new Map<string, OHLCV[]>();
    for (const record of records) {
      const date = record.timestamp.split(" ")[0];
      const existing = byDate.get(date) || [];
      existing.push(record);
      byDate.set(date, existing);
    }

    for (const [date, dateRecords] of byDate) {
      const filePath = this.getFilePath(symbol, interval, date);
      this.ensureDir(dirname(filePath));

      const lines = dateRecords.map((r) => JSON.stringify(r)).join("\n") + "\n";
      appendFileSync(filePath, lines, "utf-8");
    }
  }

  /**
   * Write OHLCV records to a date file, replacing any existing content.
   */
  write(symbol: string, interval: string, date: string, records: OHLCV[]): void {
    const filePath = this.getFilePath(symbol, interval, date);
    this.ensureDir(dirname(filePath));

    const content = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    writeFileSync(filePath, content, "utf-8");
  }

  /**
   * Read all OHLCV records for a given symbol, interval, and date.
   * Returns empty array if file doesn't exist.
   */
  read(symbol: string, interval: string, date: string): OHLCV[] {
    const filePath = this.getFilePath(symbol, interval, date);
    if (!existsSync(filePath)) return [];

    const content = readFileSync(filePath, "utf-8").trim();
    if (!content) return [];

    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as OHLCV);
  }

  /**
   * Read OHLCV records for a date range (inclusive).
   * Iterates day-by-day and collects available data.
   */
  readRange(symbol: string, interval: string, fromDate: string, toDate: string): OHLCV[] {
    const results: OHLCV[] = [];
    let current = fromDate;

    while (current <= toDate) {
      const dayData = this.read(symbol, interval, current);
      results.push(...dayData);
      current = this.nextDate(current);
    }

    return results;
  }

  /**
   * Check if data exists for a given symbol, interval, and date.
   */
  exists(symbol: string, interval: string, date: string): boolean {
    return existsSync(this.getFilePath(symbol, interval, date));
  }

  /**
   * Get the file path for a given symbol, interval, and date.
   */
  getFilePath(symbol: string, interval: string, date: string): string {
    return join(this.baseDir, symbol, interval, `${date}.ndjson`);
  }

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private nextDate(date: string): string {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  }
}
