import "../config/env.ts";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import BaseScript from "./base-script.ts";
import { nowMs, todayDate } from "../utils/time.ts";
import PaytmMoneyWebSocket from "../data/providers/paytm-money-websocket.ts";
import { OHLCV } from "../types/market-data/ohlcv.ts";
import { StockConfig } from "../types/stocks/stock-config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "..", "..", "..", "..", "data");

/**
 * In-memory candle being aggregated for the current minute.
 */
interface ActiveCandle {
  timestamp: string;         // "YYYY-MM-DD HH:mm"
  open: number;
  high: number;
  low: number;
  close: number;
  volumeAtStart: number;     // cumulative volume when this minute started
  latestVolume: number;      // latest cumulative volume seen
}

/**
 * Minute Tick Collector — WebSocket-based long-running script.
 *
 * Subscribes to ALL enabled stocks via a single WebSocket connection (QUOTE mode).
 * Aggregates incoming ticks into 1-minute OHLCV candles.
 * Flushes completed candles at XX:XX:59 so readers at XX:XX+1:00 get fresh data.
 * Writes to `data/{SYMBOL}.json` (overwritten daily).
 *
 * Usage: pnpm minute-tick-collector
 */
class MinuteTickCollector extends BaseScript {
  private streamer: PaytmMoneyWebSocket | null = null;
  private currentToken: string | null = null;

  // securityId → symbol mapping
  private securityIdToSymbol = new Map<number, string>();

  // symbol → current active candle being built
  private activeCandles = new Map<string, ActiveCandle>();

  // symbol → completed candles for today
  private completedCandles = new Map<string, OHLCV[]>();

  // Track current date for daily reset
  private currentDate = todayDate();

  // Stats
  private tickCount = 0;
  private candlesSealed = 0;
  private startTime = nowMs();

  // Stock configs for subscription
  private stocks: StockConfig[] = [];

  // Flush timer handle
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  get scriptName(): string {
    return "minute-tick-collector";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      tickCount: this.tickCount,
      candlesSealed: this.candlesSealed,
      activeStocks: this.securityIdToSymbol.size,
      uptimeMinutes: Math.round((nowMs() - this.startTime) / 1000 / 60),
      currentDate: this.currentDate,
    };
  }

  protected async run(): Promise<void> {
    mkdirSync(DATA_DIR, { recursive: true });

    // 1. Load enabled stocks
    const allStocks = await this.firebase.getAllStocks();
    this.stocks = Object.values(allStocks).filter((s) => s.enabled);

    if (this.stocks.length === 0) {
      this.log.error("No enabled stocks found — nothing to collect");
      process.exit(1);
    }

    // Build securityId → symbol map
    for (const stock of this.stocks) {
      const secId = typeof stock.securityId === "string" ? parseInt(stock.securityId, 10) : stock.securityId;
      this.securityIdToSymbol.set(secId, stock.symbol);
    }

    this.log.info(`Loaded ${this.stocks.length} stocks: ${this.stocks.map((s) => s.symbol).join(", ")}`);

    // 2. Load any existing candles for today (resume after restart)
    this.loadExistingCandles();

    // 3. Listen to token changes and connect
    this.firebase.onPublicAccessTokenChange((token: string) => {
      const isFirstConnect = this.currentToken === null;
      this.currentToken = token;

      if (isFirstConnect) {
        this.log.info("Access token loaded from Firebase");
      } else {
        this.log.info("Access token updated — reconnecting WebSocket");
        if (this.streamer) this.streamer.disconnect();
      }

      this.streamer = this.createStreamer(this.currentToken);
      this.streamer.connect();
    });

    // 4. Schedule flush at :59 of every minute
    this.scheduleNextFlush();

    // 5. Stats timer — every 5 minutes
    setInterval(() => this.logStats(), 300_000);

    // Keep alive
    await new Promise(() => {});
  }

  /**
   * Schedule the next flush to fire at XX:XX:59.
   * Calculates ms until the next :59 second mark and sets a timeout.
   * After firing, re-schedules for the next minute's :59.
   */
  private scheduleNextFlush(): void {
    const now = new Date();
    const secondsUntil59 = (59 - now.getSeconds() + 60) % 60;
    const msUntil59 = secondsUntil59 * 1000 - now.getMilliseconds();
    const delay = msUntil59 <= 0 ? 60_000 + msUntil59 : msUntil59;

    this.flushTimer = setTimeout(() => {
      this.sealAndFlushAll();
      this.scheduleNextFlush(); // re-schedule for next minute
    }, delay);
  }

  /**
   * Seal all active candles and flush to disk.
   * Called at :59 of every minute.
   */
  private sealAndFlushAll(): void {
    for (const [symbol, candle] of this.activeCandles) {
      this.sealCandle(symbol, candle);
    }
    this.activeCandles.clear();

    // Flush all stocks that have data to disk
    for (const symbol of this.completedCandles.keys()) {
      this.flushToDisk(symbol);
    }
  }

  private createStreamer(token: string): PaytmMoneyWebSocket {
    const s = new PaytmMoneyWebSocket(token);

    s.on("connected", () => {
      this.log.info("WebSocket connected — subscribing to stocks");

      const subscriptions = this.stocks.map((stock) => ({
        scripType: "ES",
        exchangeType: stock.exchange || "NSE",
        scripId: String(stock.securityId),
        modeType: "QUOTE",
      }));

      s.subscribe(subscriptions);
      this.log.info(`Subscribed to ${subscriptions.length} stocks in QUOTE mode`);
    });

    s.on("tick", (tick: Record<string, unknown>) => {
      this.tickCount++;
      this.processTick(tick);
    });

    s.on("error", (err: Error) => this.log.error("WebSocket error", err));
    s.on("disconnected", ({ code }: { code: number }) => {
      this.log.warn(`WebSocket disconnected — code=${code}`);
    });
    s.on("reconnecting", (n: number) => this.log.info(`WebSocket reconnecting — attempt ${n}`));

    return s;
  }

  /**
   * Process a single tick from the WebSocket.
   * Updates the in-memory candle for the corresponding stock.
   */
  private processTick(tick: Record<string, unknown>): void {
    const securityId = tick.security_id as number;
    const symbol = this.securityIdToSymbol.get(securityId);
    if (!symbol) return;

    const price = tick.last_price as number;
    const cumulativeVolume = (tick.volume_traded as number) || 0;

    if (typeof price !== "number" || isNaN(price)) return;

    // Check for daily reset
    const today = todayDate();
    if (today !== this.currentDate) {
      this.dailyReset(today);
    }

    const now = new Date();
    const minuteBucket = `${today} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const active = this.activeCandles.get(symbol);

    if (!active || active.timestamp !== minuteBucket) {
      // Previous candle will be sealed by the :59 timer, but if we somehow
      // skipped a minute (no ticks), seal it now
      if (active && active.timestamp !== minuteBucket) {
        this.sealCandle(symbol, active);
      }

      // Start new candle
      this.activeCandles.set(symbol, {
        timestamp: minuteBucket,
        open: price,
        high: price,
        low: price,
        close: price,
        volumeAtStart: cumulativeVolume,
        latestVolume: cumulativeVolume,
      });
    } else {
      // Update existing candle
      active.high = Math.max(active.high, price);
      active.low = Math.min(active.low, price);
      active.close = price;
      active.latestVolume = cumulativeVolume;
    }
  }

  /**
   * Seal a completed candle and add to the completed list.
   */
  private sealCandle(symbol: string, candle: ActiveCandle): void {
    const ohlcv: OHLCV = {
      timestamp: candle.timestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: Math.max(0, candle.latestVolume - candle.volumeAtStart),
    };

    const candles = this.completedCandles.get(symbol) || [];
    candles.push(ohlcv);
    this.completedCandles.set(symbol, candles);

    this.candlesSealed++;
  }

  /**
   * Write completed candles for a symbol to disk.
   * File: data/{SYMBOL}.json — complete overwrite with all candles for today.
   */
  private flushToDisk(symbol: string): void {
    const candles = this.completedCandles.get(symbol);
    if (!candles || candles.length === 0) return;

    const filePath = resolve(DATA_DIR, `${symbol}.json`);
    writeFileSync(filePath, JSON.stringify(candles, null, 2), "utf-8");
  }

  /**
   * On daily reset: seal all active candles, flush, then clear for new day.
   */
  private dailyReset(newDate: string): void {
    this.log.info(`Daily reset: ${this.currentDate} → ${newDate}`);

    // Seal all remaining active candles
    for (const [symbol, candle] of this.activeCandles) {
      this.sealCandle(symbol, candle);
    }
    this.activeCandles.clear();

    // Flush final state for yesterday
    for (const symbol of this.completedCandles.keys()) {
      this.flushToDisk(symbol);
    }

    // Clear completed candles (new day starts fresh)
    this.completedCandles.clear();
    this.currentDate = newDate;
  }

  /**
   * On startup, load any existing candles for today (resume after crash/restart).
   */
  private loadExistingCandles(): void {
    const today = todayDate();

    for (const stock of this.stocks) {
      const filePath = resolve(DATA_DIR, `${stock.symbol}.json`);
      if (!existsSync(filePath)) continue;

      try {
        const content = readFileSync(filePath, "utf-8");
        const candles: OHLCV[] = JSON.parse(content);

        // Only load if the data is from today
        if (candles.length > 0 && candles[0].timestamp.startsWith(today)) {
          this.completedCandles.set(stock.symbol, candles);
          this.log.info(`Resumed ${stock.symbol}: ${candles.length} candles from today`);
        }
      } catch {
        // File corrupt or wrong format — start fresh
      }
    }
  }

  private logStats(): void {
    const uptimeMin = Math.round((nowMs() - this.startTime) / 1000 / 60);
    const memMB = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);
    const stocksWithData = [...this.completedCandles.entries()]
      .filter(([, c]) => c.length > 0)
      .map(([sym, c]) => `${sym}(${c.length})`)
      .join(" ");

    this.log.info(
      `Stats — uptime=${uptimeMin}m ticks=${this.tickCount} sealed=${this.candlesSealed} mem=${memMB}MB | ${stocksWithData}`,
    );
  }
}

new MinuteTickCollector().start();
