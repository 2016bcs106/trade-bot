import "../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import moment from "moment";
import BaseScript from "./base-script.ts";
import { nowMs, todayDate } from "../utils/time.ts";
import { sendSlackMessage } from "../utils/slack.ts";
import TradingConfig from "../config/trading-config.ts";
import TickBuffer from "./live-stream/tick-buffer.ts";
import AggregateStore from "./live-stream/aggregate-store.ts";
import StreamerManager from "./live-stream/streamer-manager.ts";
import ClientBroadcaster from "./live-stream/client-broadcaster.ts";
import StockRegistry from "./live-stream/stock-registry.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

class LiveStreamScript extends BaseScript {
  private config = new TradingConfig();
  private dataDir = resolve(__dirname, "..", "..", "..", "..", "data");
  private tickCount = 0;
  private tickCountAtLastStats = 0;
  private startTime = nowMs();
  private currentToken: string | null = null;
  private marketStatus = "Closed";
  private lastTradeDate: string | null = null;

  private registry = new StockRegistry();
  private aggregateStore!: AggregateStore;
  private tickBuffer!: TickBuffer;
  private streamerManager!: StreamerManager;
  private broadcaster!: ClientBroadcaster;

  get scriptName(): string {
    return "live-stream";
  }

  protected getMetadata(): Record<string, unknown> {
    const stats = this.tickBuffer?.getStats();
    return {
      "Tick count": this.tickCount,
      "Ticks today": stats?.ticksToday ?? 0,
      "Raw size today": `${(stats?.rawSizeMB ?? 0).toFixed(1)} MB`,
      "Est compressed": `${(stats?.estimatedCompressedMB ?? 0).toFixed(1)} MB`,
      "Total flushed to R2": `${stats?.totalFlushed ?? 0} ticks`,
      "Uptime": `${Math.round((nowMs() - this.startTime) / 1000 / 60)} min`,
      "Tracked stocks": this.registry.stocks.length,
      "Mode": this.config.modeType,
      "Stats interval": `${this.config.statsInterval}s`,
    };
  }

  protected async run(): Promise<void> {
    this.aggregateStore = new AggregateStore(
      this.log, this.dataDir,
      (s) => this.registry.getInstrumentKey(s),
      (s) => this.registry.getScripId(s),
    );

    this.tickBuffer = new TickBuffer(
      this.log,
      () => todayDate(),
      (s) => this.registry.getScripId(s),
      this.registry.instrumentByKey,
    );

    this.streamerManager = new StreamerManager(
      this.log,
      this.config.modeType,
      (s) => this.registry.getScripId(s),
      () => this.marketStatus,
      (tick) => this.handleTick(tick),
      () => {},
    );

    this.broadcaster = new ClientBroadcaster(
      this.log,
      this.firebase,
      () => this.registry.buildStockList(),
      () => ({ status: this.marketStatus, tradeDate: this.lastTradeDate }),
      () => this.registry.favorites,
      (symbol) => this.registry.stocks.find((s) => s.symbol === symbol)?.notifySignals ?? false,
      (key) => this.aggregateStore.getSnapshotData(key),
      () => this.registry.buildFavoritePrices(this.aggregateStore),
    );

    this.aggregateStore.cleanupOldFiles();
    this.tickBuffer.cleanupOldFiles();
    this.broadcaster.start();
    this.log.info("Starting live market data recorder");

    this.firebase.onStocksChange((stocks) => {
      const active = stocks ? Object.values(stocks).filter((s) => s.securityId) : [];
      this.registry.setStocks(active);

      if (this.lastTradeDate) {
        this.loadHistoricalData();
        this.broadcaster.sendSnapshotsToSubscribers();
      }

      this.log.info(`Stocks updated — tracking ${this.registry.stocks.length}`);
      this.broadcaster.broadcastStockList();

      if (this.currentToken && this.streamerManager.isConnected && this.marketStatus !== "Closed") {
        this.streamerManager.connect(this.currentToken, this.registry.stocks);
      }
    });

    this.firebase.onPublicAccessTokenChange((token: string) => {
      const isFirstConnect = this.currentToken === null;
      this.currentToken = token;

      if (isFirstConnect) {
        this.log.info("Public access token loaded from Firebase");
      } else {
        this.log.info("Public access token updated — reconnecting");
        this.streamerManager.disconnect();
      }

      if (this.marketStatus !== "Closed") {
        this.streamerManager.connect(this.currentToken, this.registry.stocks);
      }
    });

    this.firebase.onMarketStatusChange((data) => {
      if (!data) return;
      const status = data.status === "Close" ? "Closed" : data.status;
      const prevStatus = this.marketStatus;
      const prevTradeDate = this.lastTradeDate;
      this.marketStatus = status;
      this.lastTradeDate = data.tradeDate;

      this.log.info(`Market status: ${status} | tradeDate=${data.tradeDate}`);
      this.broadcaster.broadcastAll({ type: "market_status", data: { status, tradeDate: data.tradeDate } });

      if (!prevTradeDate && data.tradeDate && this.registry.stocks.length > 0) {
        this.aggregateStore.clear();
        this.loadHistoricalData();
        this.broadcaster.sendSnapshotsToSubscribers();
      }

      if (status === "Closed" && prevStatus !== "Closed") {
        this.log.info("Market closed — flushing to R2 and disconnecting streamers");
        this.tickBuffer.flushToR2();
        this.aggregateStore.save(this.registry.instrumentByKey);
        this.streamerManager.disconnect();
      } else if (status !== "Closed" && prevStatus === "Closed") {
        this.log.info("Market opened — clearing aggregates and connecting streamers");
        this.tickBuffer.resetDailyCount();
        this.aggregateStore.clear();
        this.broadcaster.broadcastAll({ type: "day_reset", data: { reason: "market opened" } });
        if (this.currentToken) {
          this.streamerManager.connect(this.currentToken, this.registry.stocks);
        }
      }
    });

    this.firebase.onFavoritesChange((data) => {
      this.registry.setFavorites(data ? Object.keys(data) : []);
      this.log.info(`Favorites updated — ${this.registry.favorites.size} stocks`);
      this.broadcaster.broadcastStockList();
    });

    setInterval(() => this.aggregateStore.save(this.registry.instrumentByKey), 60_000);
    setInterval(() => this.logStats(), this.config.statsInterval * 1000);
    setInterval(() => this.publishStockList(), 60_000);

    await new Promise(() => {});
  }

  private handleTick(tick: Record<string, unknown>): void {
    this.tickCount++;
    const stock = this.registry.resolveStockFromTick(tick);
    if (!stock) return;

    const instrumentKey = this.registry.getInstrumentKey(stock);
    this.tickBuffer.push(tick, instrumentKey);

    const aggregate = this.aggregateStore.upsertFromTick(tick, stock);
    if (!aggregate) return;

    if (this.registry.favorites.has(stock.symbol)) {
      const priceInfo = this.aggregateStore.getPrice(instrumentKey);
      if (priceInfo) {
        this.broadcaster.broadcastPriceUpdate(instrumentKey, stock.symbol, priceInfo);
      }
    }

    if (aggregate.signal && stock.notifySignals) {
      const label = aggregate.signal.toUpperCase();
      sendSlackMessage(`${stock.symbol} ${label} @ ₹${aggregate.close.toFixed(2)} (RSI: ${aggregate.rsi?.toFixed(1) ?? '-'})`);
    }

    this.broadcaster.sendMinuteUpdate(instrumentKey, aggregate);
  }

  private loadHistoricalData(): void {
    const stocks = this.registry.stocks.map((stock) => ({
      stock,
      instrumentKey: this.registry.getInstrumentKey(stock),
    }));
    const targetDate = this.getTargetDate();
    this.aggregateStore.loadHistorical(stocks, this.marketStatus, todayDate(), targetDate);
    this.notifyHistoricalSignals();
  }

  private async notifyHistoricalSignals(): Promise<void> {
    const enabled = await this.firebase.getConfig("notifyOnRestart");
    if (!enabled) return;

    const lines: string[] = [];
    for (const stock of this.registry.stocks) {
      if (!stock.notifySignals) continue;
      const instrumentKey = this.registry.getInstrumentKey(stock);
      const data = this.aggregateStore.getSnapshotData(instrumentKey);
      for (const agg of data) {
        if (agg.signal) {
          const time = agg.minute.split("T")[1] || agg.minute;
          lines.push(`${stock.symbol} ${agg.signal.toUpperCase()} @ ₹${agg.close.toFixed(2)} (RSI: ${agg.rsi?.toFixed(1) ?? '-'}) at ${time}`);
        }
      }
    }
    if (lines.length > 0) {
      sendSlackMessage(`[Historical Signals]\n${lines.join("\n")}`);
    }
  }

  private logStats(): void {
    const uptimeMin = Math.round((nowMs() - this.startTime) / 1000 / 60);
    const ticksPerSec = ((this.tickCount - this.tickCountAtLastStats) / this.config.statsInterval).toFixed(1);
    const memUsageMB = (process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(1);
    const bufferStats = this.tickBuffer.getStats();

    this.log.info(
      `Stats — uptime=${uptimeMin}m ticks=${this.tickCount} today=${bufferStats.ticksToday} ` +
      `rate=${ticksPerSec}/s tracked=${this.aggregateStore.size} clients=${this.broadcaster.clientCount} mem=${memUsageMB}MB`,
    );
    this.tickCountAtLastStats = this.tickCount;
  }

  private publishStockList(): void {
    if (this.registry.stocks.length === 0) return;
    this.registry.computeRelevanceScores(this.aggregateStore);
    this.broadcaster.broadcastStockList();
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
}

new LiveStreamScript().start();
