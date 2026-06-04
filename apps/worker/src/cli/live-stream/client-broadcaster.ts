import fs from "fs";
import { createServer } from "https";
import { WebSocketServer, WebSocket } from "ws";
import { nowISO } from "../../utils/time.ts";
import { MinuteAggregatePayload, PriceInfo } from "./types.ts";
import { Logger } from "../../types/logger.ts";
import FirebaseClient from "../../firebase/client.ts";

export default class ClientBroadcaster {
  private wsHttpServer = createServer({
    cert: fs.readFileSync("/etc/letsencrypt/live/trade-bot-ws.duckdns.org/fullchain.pem"),
    key: fs.readFileSync("/etc/letsencrypt/live/trade-bot-ws.duckdns.org/privkey.pem"),
  });
  private wsServer = new WebSocketServer({ noServer: true });
  private clientSubscriptions = new Map<WebSocket, Set<string>>();
  private wsPort = 8081;
  private wsPath = "/live-ticks";

  constructor(
    private log: Logger,
    private firebase: FirebaseClient,
    private getStockList: () => Record<string, unknown>[],
    private getMarketStatus: () => { status: string; tradeDate: string | null },
    private getFavorites: () => Set<string>,
    private getSnapshotData: (instrumentKey: string) => MinuteAggregatePayload[],
    private getFavoritePrices: () => { instrumentKey: string; symbol: string; price: number; change: number; changePct: number }[],
  ) {}

  start(): void {
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
      this.log.info(`Client connected — ip=${ip} clients=${this.wsServer.clients.size}`);

      this.clientSubscriptions.set(client, new Set());
      this.sendTo(client, { type: "stock_list", data: this.getStockList() });
      this.sendTo(client, { type: "market_status", data: this.getMarketStatus() });
      const favPrices = this.getFavoritePrices();
      if (favPrices.length > 0) {
        this.sendTo(client, { type: "favorite_prices", data: favPrices });
      }

      client.on("message", (raw) => {
        this.handleMessage(client, raw.toString());
      });

      client.on("close", (code, reason) => {
        this.clientSubscriptions.delete(client);
        this.log.info(`Client disconnected — ip=${ip} code=${code} reason=${reason || "none"} clients=${this.wsServer.clients.size}`);
      });

      client.on("error", (err) => {
        this.log.warn(`Client error — ip=${ip} error=${err.message}`);
      });
    });

    this.wsHttpServer.listen(this.wsPort, () => {
      this.log.info(`Local broadcast websocket listening on wss://0.0.0.0:${this.wsPort}${this.wsPath}`);
    });
  }

  broadcastAll(payload: Record<string, unknown>): void {
    const message = JSON.stringify(payload);
    for (const client of this.wsServer.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  broadcastStockList(): void {
    this.broadcastAll({ type: "stock_list", data: this.getStockList() });
  }

  broadcastPriceUpdate(instrumentKey: string, symbol: string, priceInfo: PriceInfo): void {
    this.broadcastAll({ type: "price_update", data: { instrumentKey, symbol, ...priceInfo } });
  }

  sendMinuteUpdate(instrumentKey: string, aggregate: MinuteAggregatePayload): void {
    const message = JSON.stringify({ type: "minute_update", data: aggregate, meta: { instrumentKey } });
    for (const [client, subs] of this.clientSubscriptions.entries()) {
      if (subs.has(instrumentKey) && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  sendSnapshotsToSubscribers(): void {
    for (const [client, subs] of this.clientSubscriptions.entries()) {
      for (const instrumentKey of subs) {
        this.sendSnapshot(client, instrumentKey);
      }
    }
  }

  get clientCount(): number {
    return this.wsServer.clients.size;
  }

  private sendSnapshot(client: WebSocket, instrumentKey: string): void {
    if (client.readyState !== WebSocket.OPEN) return;
    const snapshot = this.getSnapshotData(instrumentKey);
    client.send(JSON.stringify({ type: "snapshot", data: snapshot, meta: { count: snapshot.length, asOf: nowISO(), instrumentKey } }));
  }

  private sendTo(client: WebSocket, payload: Record<string, unknown>): void {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(JSON.stringify(payload));
  }

  private handleMessage(client: WebSocket, raw: string): void {
    try {
      const msg = JSON.parse(raw) as { type?: string; instrumentKey?: string; symbol?: string };

      if (msg.type === "subscribe" && msg.instrumentKey) {
        const subs = this.clientSubscriptions.get(client);
        if (subs) {
          subs.add(msg.instrumentKey);
          this.sendSnapshot(client, msg.instrumentKey);
          this.log.info(`Client subscribed to ${msg.instrumentKey}`);
        }
        return;
      }

      if (msg.type === "unsubscribe" && msg.instrumentKey) {
        const subs = this.clientSubscriptions.get(client);
        if (subs) {
          subs.delete(msg.instrumentKey);
          this.log.info(`Client unsubscribed from ${msg.instrumentKey}`);
        }
        return;
      }

      if (msg.type === "toggle_favorite" && msg.symbol) {
        const favorites = this.getFavorites();
        if (favorites.has(msg.symbol)) {
          this.firebase.setValue(`favorites/${msg.symbol}`, null);
        } else {
          this.firebase.setValue(`favorites/${msg.symbol}`, true);
        }
        return;
      }
    } catch {}
  }
}
