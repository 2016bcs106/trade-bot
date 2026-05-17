import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Config } from "../lib/config.js";
import { DataFetcher } from "../lib/api.js";
import { Analyzer } from "../lib/analyzer.js";
import { Transformer } from "../lib/transformer.js";
import { Summarizer } from "../lib/summarizer.js";

// --- Parse Params ---

const config = new Config();

if (!config.isValid) {
  Config.printHelp();
  process.exit(0);
}

console.log("📊 Running analysis with params:");
console.log(JSON.stringify(config, null, 2));

// --- Run Analysis ---

const dataFetcher = new DataFetcher();
const data = await dataFetcher.fetch(config.fromDate, config.toDate, config.pmlId);

const analyzer = new Analyzer(config);
const analysis = analyzer.analyze(data);

const transformer = new Transformer();
const transformedAnalysis = transformer.transform(analysis);

const summarizer = new Summarizer();
summarizer.summarize(analysis);

// --- Write Output ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.join(projectRoot, "data");
const outputFile = path.join(dataDir, "analysis.json");

await fs.mkdir(dataDir, { recursive: true });
await fs.writeFile(outputFile, JSON.stringify(transformedAnalysis, null, 2), "utf8");

console.log(`\n✅ Output written to ${outputFile}`);
