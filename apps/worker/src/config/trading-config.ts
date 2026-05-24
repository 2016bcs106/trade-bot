import moment from "moment";

const COMMON_DEFAULTS = {
  scripId: "25",
  scripType: "EQUITY",
  exchangeType: "NSE",
};

const TRADE_BOT_DEFAULTS = {
  pmlId: "1000001121",
  cooldownWindow: 1,
  fastSmaPeriod: 7,
  slowSmaPeriod: 55,
  sidewaysWindow: 5,
  sidewaysThresholdPercent: 0,
  volatilityWindow: 5,
  maxVolatilityRangePercent: 100,
  date: moment().utcOffset("+05:30").format("YYYY-MM-DD"),
  lookbackDays: 1,
};

const LIVE_STREAM_DEFAULTS = {
  modeType: "FULL",
  flushInterval: 60,
  bufferSize: 1000,
  statsInterval: 300,
};

export type ScriptName = "trade-bot" | "live-stream" | "ml";

export default class TradingConfig {
  // Common
  scripId: string;
  scripType: string;
  exchangeType: string;
  isValid: boolean = true;

  // Trade bot
  pmlId?: string;
  cooldownWindow?: number;
  fastSmaPeriod?: number;
  slowSmaPeriod?: number;
  sidewaysWindow?: number;
  sidewaysThresholdPercent?: number;
  volatilityWindow?: number;
  maxVolatilityRangePercent?: number;
  dryRun?: boolean;
  fromDate?: string;
  toDate?: string;

  // Live stream
  modeType?: string;
  flushInterval?: number;
  bufferSize?: number;
  statsInterval?: number;

  // ML commands
  symbol?: string;
  all?: boolean;
  model?: string;
  lookbackDays?: number;

  constructor(script: ScriptName = "trade-bot", argv: string[] = process.argv.slice(2)) {
    const args = TradingConfig.parseArgs(argv);

    this.scripId = args.scripId || COMMON_DEFAULTS.scripId;
    this.scripType = args.scripType || COMMON_DEFAULTS.scripType;
    this.exchangeType = args.exchangeType || COMMON_DEFAULTS.exchangeType;

    if (script === "trade-bot") {
      this._initTradeBot(args);
    } else if (script === "live-stream") {
      this._initLiveStream(args);
    } else if (script === "ml") {
      this._initMl(args);
    }
  }

  private _initTradeBot(args: Record<string, string>): void {
    const date = args.date || TRADE_BOT_DEFAULTS.date;
    const lookbackDays = args.lookbackDays != null ? Number(args.lookbackDays) : TRADE_BOT_DEFAULTS.lookbackDays;

    this.pmlId = args.pmlId || TRADE_BOT_DEFAULTS.pmlId;
    this.cooldownWindow = args.cooldownWindow != null ? Number(args.cooldownWindow) : TRADE_BOT_DEFAULTS.cooldownWindow;
    this.fastSmaPeriod = args.fastSmaPeriod != null ? Number(args.fastSmaPeriod) : TRADE_BOT_DEFAULTS.fastSmaPeriod;
    this.slowSmaPeriod = args.slowSmaPeriod != null ? Number(args.slowSmaPeriod) : TRADE_BOT_DEFAULTS.slowSmaPeriod;
    this.sidewaysWindow = args.sidewaysWindow != null ? Number(args.sidewaysWindow) : TRADE_BOT_DEFAULTS.sidewaysWindow;
    this.sidewaysThresholdPercent = args.sidewaysThresholdPercent != null ? Number(args.sidewaysThresholdPercent) : TRADE_BOT_DEFAULTS.sidewaysThresholdPercent;
    this.volatilityWindow = args.volatilityWindow != null ? Number(args.volatilityWindow) : TRADE_BOT_DEFAULTS.volatilityWindow;
    this.maxVolatilityRangePercent = args.maxVolatilityRangePercent != null ? Number(args.maxVolatilityRangePercent) : TRADE_BOT_DEFAULTS.maxVolatilityRangePercent;
    this.dryRun = process.argv.includes("--dryRun");

    const end = moment(date, "YYYY-MM-DD", true);

    const invalidPositiveInt = (v: number) => Number.isNaN(v) || !Number.isInteger(v) || v <= 0;
    const invalidNonNegative = (v: number) => Number.isNaN(v) || v < 0;

    this.isValid = !(
      !end.isValid() ||
      !Number.isInteger(lookbackDays) || lookbackDays <= 0 ||
      invalidPositiveInt(this.cooldownWindow) ||
      invalidPositiveInt(this.fastSmaPeriod) ||
      invalidPositiveInt(this.slowSmaPeriod) ||
      invalidPositiveInt(this.sidewaysWindow) ||
      invalidNonNegative(this.sidewaysThresholdPercent) ||
      invalidPositiveInt(this.volatilityWindow) ||
      invalidNonNegative(this.maxVolatilityRangePercent)
    );

    if (this.isValid) {
      this.fromDate = end.clone().subtract(lookbackDays, "days").format("YYYY-MM-DD");
      this.toDate = end.format("YYYY-MM-DD");
    }
  }

  private _initLiveStream(args: Record<string, string>): void {
    this.modeType = args.modeType || LIVE_STREAM_DEFAULTS.modeType;
    this.flushInterval = args.flushInterval != null ? Number(args.flushInterval) : LIVE_STREAM_DEFAULTS.flushInterval;
    this.bufferSize = args.bufferSize != null ? Number(args.bufferSize) : LIVE_STREAM_DEFAULTS.bufferSize;
    this.statsInterval = args.statsInterval != null ? Number(args.statsInterval) : LIVE_STREAM_DEFAULTS.statsInterval;
    this.isValid = true;
  }

  private _initMl(args: Record<string, string>): void {
    this.symbol = args.symbol || undefined;
    this.all = args.all === "true" || process.argv.includes("--all");
    this.model = args.model || "random-forest";
    this.lookbackDays = args.lookbackDays != null ? Number(args.lookbackDays) : 1825; // 5 years
    this.isValid = !!(this.symbol || this.all);
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

  static printHelp(script: ScriptName = "trade-bot"): void {
    if (script === "trade-bot") {
      console.log(
        "Usage: node trade-bot.js [--date=YYYY-MM-DD] [--lookbackDays=N] [--pmlId=ID] [--cooldownWindow=N] [--fastSmaPeriod=N] [--slowSmaPeriod=N] [--sidewaysWindow=N] [--sidewaysThresholdPercent=VALUE] [--volatilityWindow=N] [--maxVolatilityRangePercent=VALUE] [--dryRun]"
      );
      console.log("\nDefaults:", JSON.stringify({ ...COMMON_DEFAULTS, ...TRADE_BOT_DEFAULTS }, null, 2));
    } else if (script === "live-stream") {
      console.log(
        "Usage: node live-stream.js [--scripId=25] [--scripType=EQUITY] [--exchangeType=NSE] [--modeType=FULL] [--flushInterval=60] [--bufferSize=1000] [--statsInterval=300]"
      );
      console.log("\nDefaults:", JSON.stringify({ ...COMMON_DEFAULTS, ...LIVE_STREAM_DEFAULTS }, null, 2));
    }
  }

  toJSON(): Record<string, unknown> {
    const base: Record<string, unknown> = {
      scripId: this.scripId,
      scripType: this.scripType,
      exchangeType: this.exchangeType,
    };

    if (this.pmlId !== undefined) {
      return {
        ...base,
        isValid: this.isValid,
        fromDate: this.fromDate,
        toDate: this.toDate,
        pmlId: this.pmlId,
        cooldownWindow: this.cooldownWindow,
        fastSmaPeriod: this.fastSmaPeriod,
        slowSmaPeriod: this.slowSmaPeriod,
        sidewaysWindow: this.sidewaysWindow,
        sidewaysThresholdPercent: this.sidewaysThresholdPercent,
        volatilityWindow: this.volatilityWindow,
        maxVolatilityRangePercent: this.maxVolatilityRangePercent,
        dryRun: this.dryRun,
      };
    }

    return {
      ...base,
      modeType: this.modeType,
      flushInterval: this.flushInterval,
      bufferSize: this.bufferSize,
      statsInterval: this.statsInterval,
    };
  }
}
