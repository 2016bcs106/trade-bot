import PaytmMoneyWebSocket from "../../data/providers/paytm-money-websocket.ts";
import { StockConfig } from "../../types/stocks/stock-config.ts";
import { nowISO } from "../../utils/time.ts";
import { Logger } from "../../types/logger.ts";

const MAX_STOCKS_PER_SOCKET = 500;

export default class StreamerManager {
  private streamers: PaytmMoneyWebSocket[] = [];

  constructor(
    private log: Logger,
    private modeType: string,
    private getScripId: (stock: StockConfig) => number,
    private getMarketStatus: () => string,
    private onTick: (tick: Record<string, unknown>) => void,
    private onDisconnect: () => void,
  ) {}

  connect(token: string, stocks: StockConfig[]): void {
    this.disconnect();

    const batches: StockConfig[][] = [];
    for (let i = 0; i < stocks.length; i += MAX_STOCKS_PER_SOCKET) {
      batches.push(stocks.slice(i, i + MAX_STOCKS_PER_SOCKET));
    }

    this.log.info(`Creating ${batches.length} streamer(s) for ${stocks.length} stocks`);

    for (const batch of batches) {
      const s = this.createStreamer(token, batch);
      this.streamers.push(s);
      s.connect();
    }
  }

  disconnect(): void {
    for (const s of this.streamers) {
      s.disconnect();
    }
    this.streamers = [];
  }

  get isConnected(): boolean {
    return this.streamers.length > 0;
  }

  private createStreamer(token: string, stocks: StockConfig[]): PaytmMoneyWebSocket {
    const s = new PaytmMoneyWebSocket(token);

    s.on("connected", () => {
      this.log.info(`WebSocket connected — subscribing to ${stocks.length} stocks`);
      s.subscribe(stocks.map((c) => ({
        scripType: "EQUITY",
        exchangeType: c.exchange,
        scripId: String(this.getScripId(c)),
        modeType: this.modeType,
      })));
    });

    s.on("tick", (data: Record<string, unknown>) => {
      if (this.getMarketStatus() === "Closed") return;
      const tick = { ...data, received_at: nowISO() };
      this.onTick(tick);
    });

    s.on("error", (err: Error) => this.log.error("WebSocket error", err));
    s.on("disconnected", ({ code }: { code: number }) => { this.onDisconnect(); this.log.warn(`WebSocket disconnected — code=${code}`); });
    s.on("reconnecting", (n: number) => this.log.info(`WebSocket reconnecting — attempt ${n}`));

    return s;
  }
}
