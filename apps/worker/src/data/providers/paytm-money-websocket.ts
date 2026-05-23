import WebSocket from "ws";
import { EventEmitter } from "events";

const WS_BASE_URL = "wss://developer-ws.paytmmoney.com/broadcast/user/v1/data";

const MODE_CODES: Record<string, number> = {
  LTP: 61,
  QUOTE: 62,
  FULL: 63,
  INDEX_LTP: 64,
  INDEX_QUOTE: 65,
  INDEX_FULL: 66,
};

interface SubscriptionPreference {
  scripType: string;
  exchangeType: string;
  scripId: string;
  modeType?: string;
}

interface WebSocketOptions {
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
}

/**
 * PaytmMoney Live Market Data WebSocket client.
 * Connects to the streaming API and emits parsed tick events.
 *
 * Events: "connected", "tick", "error", "disconnected", "reconnecting"
 */
export default class PaytmMoneyWebSocket extends EventEmitter {
  private accessToken: string;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private pingInterval: number;
  private ws: WebSocket | null;
  private reconnectAttempts: number;
  private subscriptions: Omit<SubscriptionPreference, "modeType">[];
  private _pingTimer: ReturnType<typeof setInterval> | null;
  private _shouldReconnect: boolean;

  constructor(accessToken: string, opts: WebSocketOptions = {}) {
    super();
    this.accessToken = accessToken;
    this.reconnectInterval = opts.reconnectInterval ?? 5000;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 10;
    this.pingInterval = opts.pingInterval ?? 30000;

    this.ws = null;
    this.reconnectAttempts = 0;
    this.subscriptions = [];
    this._pingTimer = null;
    this._shouldReconnect = true;
  }

  connect(): void {
    const url = `${WS_BASE_URL}?x_jwt_token=${this.accessToken}`;
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this.reconnectAttempts = 0;
      this._startPing();

      if (this.subscriptions.length > 0) {
        this._sendPreferences(this.subscriptions.map((s) => ({ ...s, actionType: "ADD" })));
      }

      this.emit("connected");
    });

    this.ws.on("message", (raw: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      const packets = parseBinaryPackets(buf);
      for (const packet of packets) {
        this.emit("tick", packet);
      }
    });

    this.ws.on("error", (err: Error) => this.emit("error", err));

    this.ws.on("close", (code: number, reason: Buffer) => {
      this._stopPing();
      this.emit("disconnected", { code, reason: reason?.toString() });

      if (this._shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        this.emit("reconnecting", this.reconnectAttempts);
        setTimeout(() => this.connect(), this.reconnectInterval);
      }
    });
  }

  subscribe(preferences: SubscriptionPreference | SubscriptionPreference[]): void {
    const prefs = Array.isArray(preferences) ? preferences : [preferences];

    const formatted = prefs.map((p) => ({
      actionType: "ADD",
      modeType: p.modeType || "LTP",
      scripType: p.scripType,
      exchangeType: p.exchangeType,
      scripId: String(p.scripId),
    }));

    for (const pref of formatted) {
      const { actionType: _, ...sub } = pref;
      const exists = this.subscriptions.some(
        (s) => s.scripId === sub.scripId && s.exchangeType === sub.exchangeType && s.scripType === sub.scripType,
      );
      if (!exists) this.subscriptions.push(sub);
    }

    this._sendPreferences(formatted);
  }

  unsubscribe(preferences: SubscriptionPreference | SubscriptionPreference[]): void {
    const prefs = Array.isArray(preferences) ? preferences : [preferences];

    const formatted = prefs.map((p) => ({
      actionType: "REMOVE",
      modeType: p.modeType || "LTP",
      scripType: p.scripType,
      exchangeType: p.exchangeType,
      scripId: String(p.scripId),
    }));

    for (const pref of formatted) {
      this.subscriptions = this.subscriptions.filter(
        (s) => !(s.scripId === pref.scripId && s.exchangeType === pref.exchangeType && s.scripType === pref.scripType),
      );
    }

    this._sendPreferences(formatted);
  }

  changeMode(preference: SubscriptionPreference, newMode: string): void {
    this.unsubscribe(preference);
    this.subscribe({ ...preference, modeType: newMode });
  }

  disconnect(): void {
    this._shouldReconnect = false;
    this._stopPing();
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this.subscriptions = [];
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private _sendPreferences(preferences: Record<string, string>[]): void {
    if (!this.isConnected) return;
    this.ws!.send(JSON.stringify(preferences));
  }

  private _startPing(): void {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this.isConnected) this.ws!.ping();
    }, this.pingInterval);
  }

  private _stopPing(): void {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }
}

// ─── Binary packet parsing ──────────────────────────────────────────

interface TickPacket {
  packet_code: number;
  last_price: number;
  security_id: number;
  tradable: boolean;
  mode: number;
  subscription_mode: string;
  [key: string]: unknown;
}

function parseBinaryPackets(buf: Buffer): TickPacket[] {
  if (buf.length < 1) return [];
  const packetCode = buf.readUInt8(0);

  switch (packetCode) {
    case MODE_CODES.LTP: return [parseLtpPacket(buf)];
    case MODE_CODES.QUOTE: return [parseQuotePacket(buf)];
    case MODE_CODES.FULL: return [parseFullPacket(buf)];
    case MODE_CODES.INDEX_LTP: return [parseIndexLtpPacket(buf)];
    case MODE_CODES.INDEX_QUOTE: return [parseIndexQuotePacket(buf)];
    case MODE_CODES.INDEX_FULL: return [parseIndexFullPacket(buf)];
    default: return [];
  }
}

function parseLtpPacket(buf: Buffer): TickPacket {
  return {
    packet_code: buf.readUInt8(0),
    last_price: roundPrice(buf.readFloatLE(1)),
    last_traded_time: buf.readUInt32LE(5),
    security_id: buf.readUInt32LE(9),
    tradable: buf.readUInt8(13) === 1,
    mode: buf.readUInt8(14),
    change_absolute: roundPrice(buf.readFloatLE(15)),
    change_percent: roundPrice(buf.readFloatLE(19)),
    subscription_mode: "LTP",
  };
}

function parseIndexLtpPacket(buf: Buffer): TickPacket {
  return { ...parseLtpPacket(buf), is_index: true };
}

function parseQuotePacket(buf: Buffer): TickPacket {
  return {
    packet_code: buf.readUInt8(0),
    last_price: roundPrice(buf.readFloatLE(1)),
    last_traded_time: buf.readUInt32LE(5),
    security_id: buf.readUInt32LE(9),
    tradable: buf.readUInt8(13) === 1,
    mode: buf.readUInt8(14),
    last_traded_quantity: buf.readUInt32LE(15),
    average_traded_price: roundPrice(buf.readFloatLE(19)),
    volume_traded: buf.readUInt32LE(23),
    total_buy_quantity: buf.readUInt32LE(27),
    total_sell_quantity: buf.readUInt32LE(31),
    open: roundPrice(buf.readFloatLE(35)),
    close: roundPrice(buf.readFloatLE(39)),
    high: roundPrice(buf.readFloatLE(43)),
    low: roundPrice(buf.readFloatLE(47)),
    change_percent: roundPrice(buf.readFloatLE(51)),
    change_absolute: roundPrice(buf.readFloatLE(55)),
    "52_week_high": roundPrice(buf.readFloatLE(59)),
    "52_week_low": roundPrice(buf.readFloatLE(63)),
    subscription_mode: "QUOTE",
  };
}

function parseIndexQuotePacket(buf: Buffer): TickPacket {
  return {
    packet_code: buf.readUInt8(0),
    last_price: roundPrice(buf.readFloatLE(1)),
    security_id: buf.readUInt32LE(5),
    tradable: buf.readUInt8(9) === 1,
    mode: buf.readUInt8(10),
    open: roundPrice(buf.readFloatLE(11)),
    close: roundPrice(buf.readFloatLE(15)),
    high: roundPrice(buf.readFloatLE(19)),
    low: roundPrice(buf.readFloatLE(23)),
    change_absolute: roundPrice(buf.readFloatLE(27)),
    change_percent: roundPrice(buf.readFloatLE(31)),
    "52_week_high": roundPrice(buf.readFloatLE(35)),
    "52_week_low": roundPrice(buf.readFloatLE(39)),
    subscription_mode: "QUOTE",
    is_index: true,
  };
}

function parseFullPacket(buf: Buffer): TickPacket {
  const buy_depth: Array<{ quantity: number; price: number; orders: number }> = [];
  const sell_depth: Array<{ quantity: number; price: number; orders: number }> = [];
  for (let i = 0; i < 5; i++) {
    const o = 1 + (i * 20);
    buy_depth.push({ quantity: buf.readInt32LE(o), price: roundPrice(buf.readFloatLE(o + 12)), orders: buf.readInt16LE(o + 8) });
    sell_depth.push({ quantity: buf.readInt32LE(o + 4), price: roundPrice(buf.readFloatLE(o + 16)), orders: buf.readInt16LE(o + 10) });
  }

  const packet: TickPacket = {
    packet_code: buf.readUInt8(0),
    last_price: roundPrice(buf.readFloatLE(101)),
    last_traded_time: buf.readUInt32LE(105),
    security_id: buf.readUInt32LE(109),
    tradable: buf.readUInt8(113) === 1,
    mode: buf.readUInt8(114),
    last_traded_quantity: buf.readUInt32LE(115),
    average_traded_price: roundPrice(buf.readFloatLE(119)),
    volume_traded: buf.readUInt32LE(123),
    total_buy_quantity: buf.readUInt32LE(127),
    total_sell_quantity: buf.readUInt32LE(131),
    open: roundPrice(buf.readFloatLE(135)),
    close: roundPrice(buf.readFloatLE(139)),
    high: roundPrice(buf.readFloatLE(143)),
    low: roundPrice(buf.readFloatLE(147)),
    change_percent: roundPrice(buf.readFloatLE(151)),
    change_absolute: roundPrice(buf.readFloatLE(155)),
    "52_week_high": roundPrice(buf.readFloatLE(159)),
    "52_week_low": roundPrice(buf.readFloatLE(163)),
    depth: { buy: buy_depth, sell: sell_depth },
    subscription_mode: "FULL",
  };

  if (buf.length >= 175) {
    packet.oi = buf.readUInt32LE(167);
    packet.oi_change = buf.readUInt32LE(171);
  }

  return packet;
}

function parseIndexFullPacket(buf: Buffer): TickPacket {
  return {
    packet_code: buf.readUInt8(0),
    last_price: roundPrice(buf.readFloatLE(1)),
    security_id: buf.readUInt32LE(5),
    tradable: buf.readUInt8(9) === 1,
    mode: buf.readUInt8(10),
    open: roundPrice(buf.readFloatLE(11)),
    close: roundPrice(buf.readFloatLE(15)),
    high: roundPrice(buf.readFloatLE(19)),
    low: roundPrice(buf.readFloatLE(23)),
    change_percent: roundPrice(buf.readFloatLE(27)),
    change_absolute: roundPrice(buf.readFloatLE(31)),
    last_trade_time: buf.readUInt32LE(35),
    subscription_mode: "FULL",
    is_index: true,
  };
}

function roundPrice(val: number): number {
  return Math.round(val * 100) / 100;
}

export { MODE_CODES };
