const TRADE_BOT_DEFAULTS = {
  cooldownWindow: 1,
  fastSmaPeriod: 7,
  slowSmaPeriod: 55,
  sidewaysWindow: 5,
  sidewaysThresholdPercent: 0,
  volatilityWindow: 5,
  maxVolatilityRangePercent: 100,
};

const LIVE_STREAM_DEFAULTS = {
  modeType: "FULL",
  flushInterval: 60,
  bufferSize: 1000,
  statsInterval: 300,
};

export type ScriptName = "trade-bot" | "live-stream";

export default class TradingConfig {
  // Trade bot (SMA crossover)
  cooldownWindow?: number;
  fastSmaPeriod?: number;
  slowSmaPeriod?: number;
  sidewaysWindow?: number;
  sidewaysThresholdPercent?: number;
  volatilityWindow?: number;
  maxVolatilityRangePercent?: number;

  // Live stream
  modeType?: string;
  flushInterval?: number;
  bufferSize?: number;
  statsInterval?: number;

  constructor(script: ScriptName = "trade-bot", argv: string[] = process.argv.slice(2)) {
    const args = TradingConfig.parseArgs(argv);

    if (script === "trade-bot") {
      this._initTradeBot(args);
    } else if (script === "live-stream") {
      this._initLiveStream(args);
    }
  }

  private _initTradeBot(args: Record<string, string>): void {
    this.cooldownWindow = args.cooldownWindow != null ? Number(args.cooldownWindow) : TRADE_BOT_DEFAULTS.cooldownWindow;
    this.fastSmaPeriod = args.fastSmaPeriod != null ? Number(args.fastSmaPeriod) : TRADE_BOT_DEFAULTS.fastSmaPeriod;
    this.slowSmaPeriod = args.slowSmaPeriod != null ? Number(args.slowSmaPeriod) : TRADE_BOT_DEFAULTS.slowSmaPeriod;
    this.sidewaysWindow = args.sidewaysWindow != null ? Number(args.sidewaysWindow) : TRADE_BOT_DEFAULTS.sidewaysWindow;
    this.sidewaysThresholdPercent = args.sidewaysThresholdPercent != null ? Number(args.sidewaysThresholdPercent) : TRADE_BOT_DEFAULTS.sidewaysThresholdPercent;
    this.volatilityWindow = args.volatilityWindow != null ? Number(args.volatilityWindow) : TRADE_BOT_DEFAULTS.volatilityWindow;
    this.maxVolatilityRangePercent = args.maxVolatilityRangePercent != null ? Number(args.maxVolatilityRangePercent) : TRADE_BOT_DEFAULTS.maxVolatilityRangePercent;
  }

  private _initLiveStream(args: Record<string, string>): void {
    this.modeType = args.modeType || LIVE_STREAM_DEFAULTS.modeType;
    this.flushInterval = args.flushInterval != null ? Number(args.flushInterval) : LIVE_STREAM_DEFAULTS.flushInterval;
    this.bufferSize = args.bufferSize != null ? Number(args.bufferSize) : LIVE_STREAM_DEFAULTS.bufferSize;
    this.statsInterval = args.statsInterval != null ? Number(args.statsInterval) : LIVE_STREAM_DEFAULTS.statsInterval;
  }

  static parseArgs(argv: string[]): Record<string, string> {
    return Object.fromEntries(
      argv
        .filter((arg) => arg.startsWith("--") && arg.includes("="))
        .map((arg) => {
          const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
          return [key, valueParts.join("=")];
        }),
    );
  }

  toJSON(): Record<string, unknown> {
    return {
      cooldownWindow: this.cooldownWindow,
      fastSmaPeriod: this.fastSmaPeriod,
      slowSmaPeriod: this.slowSmaPeriod,
      sidewaysWindow: this.sidewaysWindow,
      sidewaysThresholdPercent: this.sidewaysThresholdPercent,
      volatilityWindow: this.volatilityWindow,
      maxVolatilityRangePercent: this.maxVolatilityRangePercent,
      modeType: this.modeType,
      flushInterval: this.flushInterval,
      bufferSize: this.bufferSize,
      statsInterval: this.statsInterval,
    };
  }
}
