import "../config/env.js";
import { writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import moment from "moment";
import TradingConfig from "../config/trading-config.js";
import SmaCrossoverAnalyzer from "../features/sma-crossover-analyzer.js";
import FirebaseClient from "../firebase/client.js";
import PaytmMoneyClient from "../data/providers/paytm-money-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = new TradingConfig("trade-bot");
const OP_TIMEOUT_MS = 15000;

if (!config.isValid) {
  TradingConfig.printHelp("trade-bot");
  process.exit(0);
}

console.log("Running with config:");
console.log(JSON.stringify(config, null, 2));

if (config.dryRun) {
  console.log("\n*** DRY RUN MODE — No data will be saved to Firebase ***\n");
  await startDryRun();
} else {
  const firebase = new FirebaseClient();
  const paytm = new PaytmMoneyClient();
  const analyzer = new SmaCrossoverAnalyzer(config);

  let running = false;
  let resetDone = false;

  console.log("Listening for config/enabled...");

  firebase.onEnabledChange((enabled) => {
    if (enabled === true && !running) {
      console.log("Bot enabled.. starting..");
      analyzer.reset();
      running = true;
    } else if (enabled === false && running) {
      console.log("Bot disabled.. stopping..");
      running = false;
    } else if (enabled == null) {
      console.log("Config not set.. waiting...");
    }
  });

  await startLive(firebase, paytm, analyzer, () => running, () => resetDone, (v) => { resetDone = v; });
}

async function startDryRun() {
  const paytm = new PaytmMoneyClient();
  const analyzer = new SmaCrossoverAnalyzer(config);
  const testData = await paytm.getHistoricalData(config.fromDate, config.toDate, config.pmlId);

  analyzer.reset();

  const ticks = [];
  const signals = [];

  for (const point of testData) {
    const [date, time] = point.date.split(" ");
    const analysis = analyzer.next(point);

    ticks.push({ time, close: analysis.close, fastSma: analysis.fastSma, slowSma: analysis.slowSma });

    if (analysis.signal !== null) {
      signals.push({ time, signal: analysis.signal, triggerPrice: analysis.close, gain: analysis.runningProfit, status: "DRY_RUN" });
    }
  }

  const outputPath = resolve(__dirname, "..", "..", "..", "frontend", "public", "dry-run-output.json");
  const output = { ticks, signals, generatedAt: moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss") };
  writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`Processed ${testData.length} data points. Output: ${outputPath}`);
  console.log(`==== Net gain: ${signals.slice(-1)[0].gain} ====`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, label, timeoutMs = OP_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

function extractLtp(lastTradedPrice) {
  const price = lastTradedPrice?.data?.[0]?.last_price;
  if (typeof price !== "number" || Number.isNaN(price)) {
    throw new Error(`Invalid LTP response shape: ${JSON.stringify(lastTradedPrice)}`);
  }
  return price;
}

async function startLive(firebase, paytm, analyzer, isRunning, getResetDone, setResetDone) {
  let accessToken = await withTimeout(firebase.getAccessToken(), "getAccessToken");

  firebase.onAccessTokenChange((newToken) => {
    if (newToken !== accessToken) {
      console.log(`🔑 [${moment().utcOffset("+05:30").format("HH:mm:ss")}] Access token updated from Firebase`);
      accessToken = newToken;
    }
  });

  console.log(`Startup complete. Entering loop with operation timeout=${OP_TIMEOUT_MS}ms`);
  console.log(`🔑 Listening for token changes in Firebase...`);

  setInterval(() => {
    console.log(`[Heartbeat] ${moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss")}`);
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
        const analysis = analyzer.next({ date: `${date} ${time}`, close: price });

        await withTimeout(
          firebase.storeTick(date, { time, close: analysis.close, fastSma: analysis.fastSma, slowSma: analysis.slowSma }),
          "storeTick",
        );

        if (isRunning()) {
          console.log("Bot is analyzing: ", time);
          if (analysis.signal !== null) {
            await withTimeout(
              firebase.storeSignal(date, { time, signal: analysis.signal, triggerPrice: price, gain: analysis.runningProfit, status: "DRY_RUN" }),
              "storeSignal",
            );
          }
        } else {
          console.log("Bot not running: ", time);
        }
      } else if (time >= "09:00" && time <= "09:14") {
        if (!getResetDone()) {
          console.log("Pre-market reset...");
          await withTimeout(firebase.clearTicks(), "clearTicks");
          await withTimeout(firebase.clearSignals(), "clearSignals");
          analyzer.reset();
          setResetDone(true);
          console.log("Reset complete.");
        }
      } else {
        setResetDone(false);
        console.log("Outside market hours: ", time);
      }
    } catch (error) {
      console.error(
        `[Loop Error] ${moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss")} - ${error?.message || error}`,
        error,
      );
    }

    const elapsedTime = Date.now() - startTime;
    const waitTime = 60000 - elapsedTime;
    await wait(Math.max(0, waitTime));
  }
}
