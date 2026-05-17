import { Config } from "../lib/config.js";
import { DataFetcher } from "../lib/api.js";
import { Analyzer } from "../lib/analyzer.js";

const config = new Config();

if (!config.isValid) {
  Config.printHelp();
  process.exit(0);
}

console.log("Running with config:");
console.log(JSON.stringify(config, null, 2));

const analyzer = new Analyzer(config);

const dataFetcher = new DataFetcher();
await dataFetcher.fetch(config.fromDate, config.toDate, config.pmlId, (point) => {
  console.log("\nDATA POINT:", JSON.stringify(point));

  const result = analyzer.next(point);
  console.log("ANALYSIS:", JSON.stringify(result));

  if (result.signal) {
    console.log(`SIGNAL: ${result.signal} ${result.units} units @ ${result.close} | P&L: ${result.runningProfit}`);
  }
});

console.log("\n✅ Done");
