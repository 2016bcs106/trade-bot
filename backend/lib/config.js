import moment from "moment";

const DEFAULTS = {
  pmlId: "1000001121",
  cooldownWindow: 1,
  fastSmaPeriod: 7,
  slowSmaPeriod: 55,
  sidewaysWindow: 5,
  sidewaysThresholdPercent: 0,
  volatilityWindow: 5,
  maxVolatilityRangePercent: 100,
  date: moment().format("YYYY-MM-DD"),
  lookbackDays: 30,
};

export class Config {
  constructor(argv = process.argv.slice(2)) {
    const args = Object.fromEntries(
      argv.map((arg) => {
        const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
        return [key, valueParts.join("=")];
      }),
    );

    const date = args.date || DEFAULTS.date;
    const lookbackDays = args.lookbackDays != null ? Number(args.lookbackDays) : DEFAULTS.lookbackDays;

    this.pmlId = args.pmlId || DEFAULTS.pmlId;
    this.cooldownWindow = args.cooldownWindow != null ? Number(args.cooldownWindow) : DEFAULTS.cooldownWindow;
    this.fastSmaPeriod = args.fastSmaPeriod != null ? Number(args.fastSmaPeriod) : DEFAULTS.fastSmaPeriod;
    this.slowSmaPeriod = args.slowSmaPeriod != null ? Number(args.slowSmaPeriod) : DEFAULTS.slowSmaPeriod;
    this.sidewaysWindow = args.sidewaysWindow != null ? Number(args.sidewaysWindow) : DEFAULTS.sidewaysWindow;
    this.sidewaysThresholdPercent = args.sidewaysThresholdPercent != null ? Number(args.sidewaysThresholdPercent) : DEFAULTS.sidewaysThresholdPercent;
    this.volatilityWindow = args.volatilityWindow != null ? Number(args.volatilityWindow) : DEFAULTS.volatilityWindow;
    this.maxVolatilityRangePercent = args.maxVolatilityRangePercent != null ? Number(args.maxVolatilityRangePercent) : DEFAULTS.maxVolatilityRangePercent;

    const end = moment(date, "YYYY-MM-DD", true);

    const invalidPositiveInt = (v) => Number.isNaN(v) || !Number.isInteger(v) || v <= 0;
    const invalidNonNegative = (v) => Number.isNaN(v) || v < 0;

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

  static printHelp() {
    console.log(
      "Usage: node trade-bot.js [--date=YYYY-MM-DD] [--lookbackDays=N] [--pmlId=ID] [--cooldownWindow=N] [--fastSmaPeriod=N] [--slowSmaPeriod=N] [--sidewaysWindow=N] [--sidewaysThresholdPercent=VALUE] [--volatilityWindow=N] [--maxVolatilityRangePercent=VALUE]"
    );
    console.log("\nAll parameters are optional. Defaults:");
    console.log(JSON.stringify(DEFAULTS, null, 2));
  }

  toJSON() {
    return {
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
    };
  }
}
