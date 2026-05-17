import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

import { Config } from "../lib/config.js";
import { DataFetcher } from "../lib/api.js";
import { Analyzer } from "../lib/analyzer.js";
import moment from "moment";

const config = new Config();

if (!config.isValid) {
    Config.printHelp();
    process.exit(0);
}

console.log("Running with config:");
console.log(JSON.stringify(config, null, 2));

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

async function start() {
    const accessToken = await dataFetcher.getAccessToken();

    while (true) {
        const startTime = Date.now();
        const date = moment().utcOffset("+05:30").format("YYYY-MM-DD");
        const time = moment().utcOffset("+05:30").format("HH:mm");

        if (time >= '09:15' && time <= '15:30') {
            const lastTradedPrice = await dataFetcher.fetchLTP("NSE", 25, "EQUITY", accessToken);
            const price = lastTradedPrice.data[0].last_price;
            const analysis = analyzer.next({ date: `${date} ${time}`, close: price });

            await dataFetcher.storeTick(date, { time, close: analysis.close, fastSma: analysis.fastSma, slowSma: analysis.slowSma });

            if (running) {
                console.log("Bot is analyzing: ", time);
                if (analysis.signal !== null) {
                    await dataFetcher.storeSignal(date, { time, signal: analysis.signal, triggerPrice: price, gain: analysis.runningProfit, status: 'DRY_RUN' });
                }
            } else {
                console.log("Bot not running: ", time);
            }
        } else if (time >= '09:00' && time <= '09:14') {
            if (!resetDone) {
                console.log("Pre-market reset...");
                await dataFetcher.clearTicks();
                await dataFetcher.clearSignals();
                analyzer.reset();
                resetDone = true;
                console.log("Reset complete.");
            }
        } else {
            resetDone = false;
            console.log("Outside market hours: ", time);
        }

        const elapsedTime = Date.now() - startTime;
        const waitTime = 60000 - elapsedTime;
        await wait(Math.max(0, waitTime));
    }

    console.log("Stopped.");
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

await start();
