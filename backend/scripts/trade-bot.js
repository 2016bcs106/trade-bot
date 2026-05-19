import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

import { Config } from "../lib/config.js";
import { DataFetcher } from "../lib/api.js";
import { Analyzer } from "../lib/analyzer.js";
import moment from "moment";

const config = new Config();
const dryRun = process.argv.includes("--dryRun");
const OP_TIMEOUT_MS = 15000;

if (!config.isValid) {
    Config.printHelp();
    process.exit(0);
}

console.log("Running with config:");
console.log(JSON.stringify(config, null, 2));

if (dryRun) {
    console.log("\n*** DRY RUN MODE — No data will be saved to Firebase ***\n");
    await startDryRun();
} else {
    const dataFetcher = new DataFetcher();
    const analyzer = new Analyzer(config);

    let running = false;
    let resetDone = false;

    console.log("Listening for config/enabled...");

    dataFetcher.onEnabledChange((enabled) => {
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

    await startLive(dataFetcher, analyzer, () => running, () => resetDone, (v) => { resetDone = v; });
}

async function startDryRun() {
    const dataFetcher = new DataFetcher();
    const analyzer = new Analyzer(config);
    const testData = await dataFetcher.getDryRunData(config.fromDate, config.toDate, config.pmlId);

    analyzer.reset();

    const ticks = [];
    const signals = [];

    for (const point of testData) {
        const [date, time] = point.date.split(" ");
        const analysis = analyzer.next(point);

        ticks.push({ time, close: analysis.close, fastSma: analysis.fastSma, slowSma: analysis.slowSma });

        if (analysis.signal !== null) {
            signals.push({ time, signal: analysis.signal, triggerPrice: analysis.close, gain: analysis.runningProfit, status: 'DRY_RUN' });
        }
    }

    // Write output JSON for the front-end
    const outputPath = resolve(__dirname, "..", "..", "front-end", "public", "dry-run-output.json");
    const output = { ticks, signals, generatedAt: moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss") };
    writeFileSync(outputPath, JSON.stringify(output, null, 2));

    console.log(`Processed ${testData.length} data points. Output: ${outputPath}`);
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

async function startLive(dataFetcher, analyzer, isRunning, getResetDone, setResetDone) {
    const accessToken = await withTimeout(
        dataFetcher.getAccessToken(),
        "getAccessToken",
    );

    console.log(`Startup complete. Entering loop with operation timeout=${OP_TIMEOUT_MS}ms`);

    setInterval(() => {
        console.log(`[Heartbeat] ${moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss")}`);
    }, 300000);

    while (true) {
        const startTime = Date.now();
        try {
            const date = moment().utcOffset("+05:30").format("YYYY-MM-DD");
            const time = moment().utcOffset("+05:30").format("HH:mm");

            if (time >= '09:15' && time <= '15:30') {
                const lastTradedPrice = await withTimeout(
                    dataFetcher.fetchLTP("NSE", 25, "EQUITY", accessToken),
                    "fetchLTP",
                );
                const price = extractLtp(lastTradedPrice);
                const analysis = analyzer.next({ date: `${date} ${time}`, close: price });

                await withTimeout(
                    dataFetcher.storeTick(date, {
                        time,
                        close: analysis.close,
                        fastSma: analysis.fastSma,
                        slowSma: analysis.slowSma,
                    }),
                    "storeTick",
                );

                if (isRunning()) {
                    console.log("Bot is analyzing: ", time);
                    if (analysis.signal !== null) {
                        await withTimeout(
                            dataFetcher.storeSignal(date, {
                                time,
                                signal: analysis.signal,
                                triggerPrice: price,
                                gain: analysis.runningProfit,
                                status: 'DRY_RUN',
                            }),
                            "storeSignal",
                        );
                    }
                } else {
                    console.log("Bot not running: ", time);
                }
            } else if (time >= '09:00' && time <= '09:14') {
                if (!getResetDone()) {
                    console.log("Pre-market reset...");
                    await withTimeout(dataFetcher.clearTicks(), "clearTicks");
                    await withTimeout(dataFetcher.clearSignals(), "clearSignals");
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

    console.log("Stopped.");
}
