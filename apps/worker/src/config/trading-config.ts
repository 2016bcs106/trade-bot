const DEFAULTS = {
  modeType: "FULL",
  flushInterval: 60,
  bufferSize: 1000,
  statsInterval: 300,
};

export default class TradingConfig {
  modeType: string;
  flushInterval: number;
  bufferSize: number;
  statsInterval: number;

  constructor(argv: string[] = process.argv.slice(2)) {
    const args = TradingConfig.parseArgs(argv);
    this.modeType = args.modeType || DEFAULTS.modeType;
    this.flushInterval = args.flushInterval != null ? Number(args.flushInterval) : DEFAULTS.flushInterval;
    this.bufferSize = args.bufferSize != null ? Number(args.bufferSize) : DEFAULTS.bufferSize;
    this.statsInterval = args.statsInterval != null ? Number(args.statsInterval) : DEFAULTS.statsInterval;
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
      modeType: this.modeType,
      flushInterval: this.flushInterval,
      bufferSize: this.bufferSize,
      statsInterval: this.statsInterval,
    };
  }
}
