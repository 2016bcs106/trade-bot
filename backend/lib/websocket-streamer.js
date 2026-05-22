import WebSocket from "ws";
import { EventEmitter } from "events";

/**
 * PaytmMoney Live Market Data WebSocket Streamer
 *
 * Connects to the Paytm Money WebSocket streaming API and emits real-time
 * market data events. Standalone module — does not depend on any analyzer.
 *
 * Usage:
 *   const streamer = new WebSocketStreamer(publicAccessToken);
 *   streamer.on("tick", (data) => console.log(data));
 *   streamer.on("connected", () => {
 *     streamer.subscribe({ scripType: "EQUITY", exchangeType: "NSE", scripId: "25", modeType: "LTP" });
 *   });
 *   streamer.connect();
 *
 * Events emitted:
 *   - "connected"       — WebSocket connection established
 *   - "tick"            — Market data received (parsed JSON object)
 *   - "error"          — Connection or parsing error
 *   - "disconnected"   — WebSocket closed (with code and reason)
 *   - "reconnecting"   — Attempting reconnection
 *
 * @see https://developer.paytmmoney.com/docs/api/live-market-data-webSocket-streaming
 */

const WS_BASE_URL = "wss://developer-ws.paytmmoney.com/broadcast/user/v1/data";

// Mode byte codes from the API docs
const MODE_CODES = {
  LTP: 61,
  QUOTE: 62,
  FULL: 63,
  INDEX_LTP: 64,
  INDEX_QUOTE: 65,
  INDEX_FULL: 66,
};

export class WebSocketStreamer extends EventEmitter {
  /**
   * @param {string} accessToken — Public JWT access token for Paytm Money API
   * @param {object} opts
   * @param {number} opts.reconnectInterval — ms between reconnection attempts (default 5000)
   * @param {number} opts.maxReconnectAttempts — max retries before giving up (default 10)
   * @param {number} opts.pingInterval — ms between ping frames to keep alive (default 30000)
   */
  constructor(accessToken, opts = {}) {
    super();
    this.accessToken = accessToken;
    this.reconnectInterval = opts.reconnectInterval ?? 5000;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 10;
    this.pingInterval = opts.pingInterval ?? 30000;

    this.ws = null;
    this.reconnectAttempts = 0;
    this.subscriptions = []; // Track active subscriptions for reconnect
    this._pingTimer = null;
    this._shouldReconnect = true;
  }

  /**
   * Connect to the WebSocket streaming server.
   */
  connect() {
    const url = `${WS_BASE_URL}?x_jwt_token=${this.accessToken}`;

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log("[WebSocketStreamer] Connected.");
      this.reconnectAttempts = 0;
      this._startPing();

      // Re-subscribe to previously active subscriptions on reconnect
      if (this.subscriptions.length > 0) {
        this._sendPreferences(this.subscriptions.map((s) => ({ ...s, actionType: "ADD" })));
      }

      this.emit("connected");
    });

    this.ws.on("message", (raw) => {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const packets = parseBinaryPackets(buf);
      for (const packet of packets) {
        this.emit("tick", packet);
      }
    });

    this.ws.on("error", (err) => {
      console.error("[WebSocketStreamer] Error:", err.message);
      this.emit("error", err);
    });

    this.ws.on("close", (code, reason) => {
      console.log(`[WebSocketStreamer] Disconnected. Code: ${code}, Reason: ${reason || "N/A"}`);
      this._stopPing();
      this.emit("disconnected", { code, reason: reason?.toString() });

      if (this._shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        console.log(
          `[WebSocketStreamer] Reconnecting in ${this.reconnectInterval}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
        );
        this.emit("reconnecting", this.reconnectAttempts);
        setTimeout(() => this.connect(), this.reconnectInterval);
      }
    });
  }

  /**
   * Subscribe to live market data for one or more scrips.
   *
   * @param {object|object[]} preferences — Single or array of subscription preferences
   * @param {string} preferences.scripType — "INDEX" | "EQUITY" | "ETF" | "FUTURE" | "OPTION"
   * @param {string} preferences.exchangeType — "NSE" | "BSE"
   * @param {string} preferences.scripId — Security/scrip ID (e.g. "13" for NIFTY 50 index, "25" for Adani Ent)
   * @param {string} [preferences.modeType="LTP"] — "LTP" | "QUOTE" | "FULL"
   */
  subscribe(preferences) {
    const prefs = Array.isArray(preferences) ? preferences : [preferences];

    const formatted = prefs.map((p) => ({
      actionType: "ADD",
      modeType: p.modeType || "LTP",
      scripType: p.scripType,
      exchangeType: p.exchangeType,
      scripId: String(p.scripId),
    }));

    // Track subscriptions for reconnect
    for (const pref of formatted) {
      const { actionType, ...sub } = pref;
      const exists = this.subscriptions.some(
        (s) => s.scripId === sub.scripId && s.exchangeType === sub.exchangeType && s.scripType === sub.scripType
      );
      if (!exists) {
        this.subscriptions.push(sub);
      }
    }

    this._sendPreferences(formatted);
  }

  /**
   * Unsubscribe from live market data for one or more scrips.
   *
   * @param {object|object[]} preferences — Same shape as subscribe, without modeType
   * @param {string} preferences.scripType
   * @param {string} preferences.exchangeType
   * @param {string} preferences.scripId
   * @param {string} [preferences.modeType="LTP"]
   */
  unsubscribe(preferences) {
    const prefs = Array.isArray(preferences) ? preferences : [preferences];

    const formatted = prefs.map((p) => ({
      actionType: "REMOVE",
      modeType: p.modeType || "LTP",
      scripType: p.scripType,
      exchangeType: p.exchangeType,
      scripId: String(p.scripId),
    }));

    // Remove from tracked subscriptions
    for (const pref of formatted) {
      this.subscriptions = this.subscriptions.filter(
        (s) => !(s.scripId === pref.scripId && s.exchangeType === pref.exchangeType && s.scripType === pref.scripType)
      );
    }

    this._sendPreferences(formatted);
  }

  /**
   * Change mode for an already-subscribed scrip (e.g., switch from LTP to FULL).
   * Internally unsubscribes the old mode and subscribes with the new one.
   *
   * @param {object} preference
   * @param {string} newMode — "LTP" | "QUOTE" | "FULL"
   */
  changeMode(preference, newMode) {
    this.unsubscribe(preference);
    this.subscribe({ ...preference, modeType: newMode });
  }

  /**
   * Gracefully disconnect. Will NOT attempt to reconnect.
   */
  disconnect() {
    this._shouldReconnect = false;
    this._stopPing();
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
    this.subscriptions = [];
    console.log("[WebSocketStreamer] Disconnected (manual).");
  }

  /**
   * Check if connected.
   * @returns {boolean}
   */
  get isConnected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ─── Internal helpers ───────────────────────────────────────────

  _sendPreferences(preferences) {
    if (!this.isConnected) {
      console.warn("[WebSocketStreamer] Cannot send — not connected.");
      return;
    }
    const payload = JSON.stringify(preferences);
    this.ws.send(payload);
    console.log(`[WebSocketStreamer] Sent preferences: ${payload}`);
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this.isConnected) {
        this.ws.ping();
      }
    }, this.pingInterval);
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }
}

/**
 * Parse a binary packet from the Paytm Money WebSocket stream.
 * All multi-byte values are Little Endian.
 *
 * Each WebSocket message = one complete packet.
 * The first byte (packet_code) determines the type and total length:
 *
 *   61 = LTP          (23 bytes)
 *   62 = QUOTE        (67 bytes)
 *   63 = FULL         (175 bytes)
 *   64 = INDEX LTP    (23 bytes)
 *   65 = INDEX QUOTE  (43 bytes)
 *   66 = INDEX FULL   (39 bytes)
 */
function parseBinaryPackets(buf) {
  if (buf.length < 1) return [];

  const packetCode = buf.readUInt8(0);

  switch (packetCode) {
    case MODE_CODES.LTP:
      return [parseLtpPacket(buf)];
    case MODE_CODES.QUOTE:
      return [parseQuotePacket(buf)];
    case MODE_CODES.FULL:
      return [parseFullPacket(buf)];
    case MODE_CODES.INDEX_LTP:
      return [parseIndexLtpPacket(buf)];
    case MODE_CODES.INDEX_QUOTE:
      return [parseIndexQuotePacket(buf)];
    case MODE_CODES.INDEX_FULL:
      return [parseIndexFullPacket(buf)];
    default:
      console.warn(`[WebSocketStreamer] Unknown packet code: ${packetCode}, length: ${buf.length}`);
      return [];
  }
}

/**
 * LTP Packet (23 bytes)
 * Offset 0:     packet_code (uint8)
 * Offset 1-4:   last_price (float LE)
 * Offset 5-8:   last_traded_time (uint32 LE)
 * Offset 9-12:  security_id (uint32 LE)
 * Offset 13:    tradable (uint8)
 * Offset 14:    mode (uint8)
 * Offset 15-18: change_absolute (float LE)
 * Offset 19-22: change_percent (float LE)
 */
function parseLtpPacket(buf) {
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

/**
 * INDEX LTP Packet (23 bytes) — same layout as LTP
 */
function parseIndexLtpPacket(buf) {
  return {
    ...parseLtpPacket(buf),
    subscription_mode: "LTP",
    is_index: true,
  };
}

/**
 * QUOTE Packet (67 bytes)
 * Offset 0:     packet_code (uint8)
 * Offset 1-4:   last_price (float LE)
 * Offset 5-8:   last_traded_time (uint32 LE)
 * Offset 9-12:  security_id (uint32 LE)
 * Offset 13:    tradable (uint8)
 * Offset 14:    mode (uint8)
 * Offset 15-18: last_traded_quantity (uint32 LE)
 * Offset 19-22: average_traded_price (float LE)
 * Offset 23-26: volume_traded (uint32 LE)
 * Offset 27-30: total_buy_quantity (uint32 LE)
 * Offset 31-34: total_sell_quantity (uint32 LE)
 * Offset 35-38: open (float LE)
 * Offset 39-42: close (float LE)
 * Offset 43-46: high (float LE)
 * Offset 47-50: low (float LE)
 * Offset 51-54: change_percent (float LE)
 * Offset 55-58: change_absolute (float LE)
 * Offset 59-62: 52_week_high (float LE)
 * Offset 63-66: 52_week_low (float LE)
 */
function parseQuotePacket(buf) {
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

/**
 * INDEX QUOTE Packet (43 bytes)
 * Offset 0:     packet_code (uint8)
 * Offset 1-4:   last_price (float LE)
 * Offset 5-8:   security_id (uint32 LE)
 * Offset 9:     tradable (uint8)
 * Offset 10:    mode (uint8)
 * Offset 11-14: open (float LE)
 * Offset 15-18: close (float LE)
 * Offset 19-22: high (float LE)
 * Offset 23-26: low (float LE)
 * Offset 27-30: change_absolute (float LE)
 * Offset 31-34: change_percent (float LE)
 * Offset 35-38: 52_week_high (float LE)
 * Offset 39-42: 52_week_low (float LE)
 */
function parseIndexQuotePacket(buf) {
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

/**
 * FULL Packet (175 bytes)
 * Offset 0:       packet_code (uint8)
 * Offset 1-100:   Market Depth (5 levels × 20 bytes each)
 *   Each level (20 bytes):
 *     Offset +0:  buy_quantity (int32 LE)
 *     Offset +4:  sell_quantity (int32 LE)
 *     Offset +8:  buy_orders (int16 LE)
 *     Offset +10: sell_orders (int16 LE)
 *     Offset +12: buy_price (float LE)
 *     Offset +16: sell_price (float LE)
 * Offset 101-104: last_price (float LE)
 * Offset 105-108: last_traded_time (uint32 LE)
 * Offset 109-112: security_id (uint32 LE)
 * Offset 113:     tradable (uint8)
 * Offset 114:     mode (uint8)
 * Offset 115-118: last_traded_quantity (uint32 LE)
 * Offset 119-122: average_traded_price (float LE)
 * Offset 123-126: volume_traded (uint32 LE)
 * Offset 127-130: total_buy_quantity (uint32 LE)
 * Offset 131-134: total_sell_quantity (uint32 LE)
 * Offset 135-138: open (float LE)
 * Offset 139-142: close (float LE)
 * Offset 143-146: high (float LE)
 * Offset 147-150: low (float LE)
 * Offset 151-154: change_percent (float LE)
 * Offset 155-158: change_absolute (float LE)
 * Offset 159-162: 52_week_high (float LE)
 * Offset 163-166: 52_week_low (float LE)
 * Offset 167-170: oi (uint32 LE)
 * Offset 171-174: oi_change (uint32 LE)
 */
function parseFullPacket(buf) {
  // Parse market depth (5 levels, 20 bytes each, starting at offset 1)
  const buy_depth = [];
  const sell_depth = [];
  for (let i = 0; i < 5; i++) {
    const o = 1 + (i * 20);
    buy_depth.push({
      quantity: buf.readInt32LE(o),
      price: roundPrice(buf.readFloatLE(o + 12)),
      orders: buf.readInt16LE(o + 8),
    });
    sell_depth.push({
      quantity: buf.readInt32LE(o + 4),
      price: roundPrice(buf.readFloatLE(o + 16)),
      orders: buf.readInt16LE(o + 10),
    });
  }

  const packet = {
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

  // OI fields if packet is long enough
  if (buf.length >= 175) {
    packet.oi = buf.readUInt32LE(167);
    packet.oi_change = buf.readUInt32LE(171);
  }

  return packet;
}

/**
 * INDEX FULL Packet (39 bytes)
 * Offset 0:     packet_code (uint8)
 * Offset 1-4:   last_price (float LE)
 * Offset 5-8:   security_id (uint32 LE)
 * Offset 9:     tradable (uint8)
 * Offset 10:    mode (uint8)
 * Offset 11-14: open (float LE)
 * Offset 15-18: close (float LE)
 * Offset 19-22: high (float LE)
 * Offset 23-26: low (float LE)
 * Offset 27-30: change_percent (float LE)
 * Offset 31-34: change_absolute (float LE)
 * Offset 35-38: last_trade_time (uint32 LE)
 */
function parseIndexFullPacket(buf) {
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

function roundPrice(val) {
  return Math.round(val * 100) / 100;
}

// Export mode codes for external use
export { MODE_CODES };
