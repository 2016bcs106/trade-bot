import "../config/env.ts";
import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import moment from "moment";
import createLogger from "../utils/logger.ts";
import TradingConfig from "../config/trading-config.ts";
import SmaCrossoverAnalyzer from "../features/sma-crossover-analyzer.ts";
import FirebaseClient from "../firebase/client.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";
import { LtpResponse } from "../types/ltp-response.ts";
import { AnalysisResult } from "../types/analysis-result.ts";

const log = createLogger("trade-bot");
const __dirname = dirname(fileURLToPath(import.meta.url));
const config = new TradingConfig("trade-bot");
const OP_TIMEOUT_MS = 15000;

if (!config.isValid) {
  TradingConfig.printHelp("trade-bot");
  process.exit(0);
}

log.info("Starting with config", config.toJSON());

if (config.dryRun) {
  log.info("DRY RUN MODE — No data will be saved to Firebase");
  await startDryRun();
} else {
  const firebase = new FirebaseClient();
  const paytm = new PaytmMoneyClient();
  const analyzer = new SmaCrossoverAnalyzer(config);

  let running = false;
  let resetDone = false;

  log.info("Listening for config/enabled...");

  firebase.onEnabledChange((enabled: boolean | null) => {
    if (enabled === true && !running) {
      log.info("Bot enabled — starting analysis loop");
      analyzer.reset();
      running = true;
    } else if (enabled === false && running) {
      log.info("Bot disabled — pausing analysis loop");
      running = false;
    } else if (enabled == null) {
      log.warn("Config not set — waiting for enabled flag");
    }
  });

  await startLive(firebase, paytm, analyzer, () => running, () => resetDone, (v: boolean) => { resetDone = v; });
}

async function startDryRun(): Promise<void> {
  const paytm = new PaytmMoneyClient();
  const analyzer = new SmaCrossoverAnalyzer(config);
  const testData = await paytm.getHistoricalData(config.fromDate!, config.toDate!, config.pmlId!);

  analyzer.reset();

  const ticks: Array<{ time: string; close: number; fastSma: number | null; slowSma: number | null }> = [];
  const signals: Array<{ time: string; signal: string; triggerPrice: number; gain: number; status: string }> = [];

  for (const point of testData) {
    const [, time] = point.date.split(" ");
    const analysis = analyzer.next(point);

    ticks.push({ time, close: analysis.close, fastSma: analysis.fastSma, slowSma: analysis.slowSma });

    if (analysis.signal !== null) {
      signals.push({ time, signal: analysis.signal, triggerPrice: analysis.close, gain: analysis.runningProfit, status: "DRY_RUN" });
    }
  }

  const outputPath = resolve(__dirname, "..", "..", "..", "frontend", "public", "dry-run-output.json");
  const output = { ticks, signals, generatedAt: moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss") };
  writeFileSync(outputPath, JSON.stringify(output, null, 2));

  log.info(`Processed ${testData.length} data points — output: ${outputPath}`);
  log.info(`Net gain: ${signals.slice(-1)[0]?.gain ?? 0}`);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number = OP_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

function extractLtp(lastTradedPrice: LtpResponse): number {
  const price = lastTradedPrice?.data?.[0]?.last_price;
  if (typeof price !== "number" || Number.isNaN(price)) {
    throw new Error(`Invalid LTP response: ${JSON.stringify(lastTradedPrice)}`);
  }
  return price;
}

async function startLive(
  firebase: FirebaseClient,
  paytm: PaytmMoneyClient,
  analyzer: SmaCrossoverAnalyzer,
  isRunning: () => boolean,
  getResetDone: () => boolean,
  setResetDone: (v: boolean) => void,
): Promise<void> {
  let accessToken = await withTimeout(firebase.getAccessToken(), "getAccessToken");
  log.info("Access token loaded from Firebase");

  firebase.onAccessTokenChange((newToken: string) => {
    if (newToken !== accessToken) {
      log.info("Access token updated from Firebase");
      accessToken = newToken;
    }
  });

  log.info(`Entering main loop — operation timeout: ${OP_TIMEOUT_MS}ms`);

  setInterval(() => {
    log.info("Heartbeat — process alive");
  }, 300000);

  while (true) {
    const startTime = Date.now();
    try {
      const date = moment().utcOffset("+05:30").format("YYYY-MM-DD");
      const time = moment().utcOffset("+05:30").format("HH:mm");

      if (time >= "09:15" && time <= "15:30") {
        const lastTradedPrice = await withTimeout(
          paytm.fetchLTP(config.exchangeType, config.scripId, config.scripType, accessToken),
          "fetchLTP",
        );
        const price = extractLtp(lastTradedPrice);
        const analysis: AnalysisResult = analyzer.next({ date: `${date} ${time}`, close: price });

        await withTimeout(
          firebase.storeTick(date, { time, close: analysis.close, fastSma: analysis.fastSma, slowSma: analysis.slowSma }),
          "storeTick",
        );

        if (isRunning()) {
          log.debug(`Tick processed — time=${time} price=${price} fastSma=${analysis.fastSma} slowSma=${analysis.slowSma}`);
          if (analysis.signal !== null) {
            log.info(`Signal generated: ${analysis.signal} @ ${price} | gain=${analysis.runningProfit}`);
            await withTimeout(
              firebase.storeSignal(date, { time, signal: analysis.signal, triggerPrice: price, gain: analysis.runningProfit, status: "DRY_RUN" }),
              "storeSignal",
            );
          }
        } else {
          log.debug(`Tick stored but bot paused — time=${time}`);
        }
      } else if (time >= "09:00" && time <= "09:14") {
        if (!getResetDone()) {
          log.info("Pre-market reset — clearing ticks and signals");
          await withTimeout(firebase.clearTicks(), "clearTicks");
          await withTimeout(firebase.clearSignals(), "clearSignals");
          analyzer.reset();
          setResetDone(true);
          log.info("Pre-market reset complete");
        }
      } else {
        setResetDone(false);
        log.debug(`Outside market hours — time=${time}`);
      }
    } catch (error) {
      log.error("Loop error", error);
    }

    const elapsedTime = Date.now() - startTime;
    const waitTime = 60000 - elapsedTime;
    await wait(Math.max(0, waitTime));
  }
}
