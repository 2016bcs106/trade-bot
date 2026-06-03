import "../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { readdirSync, readFileSync } from "fs";
import moment from "moment";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "..", "..", "..", "..", "data");

const FORWARD_WINDOWS = [1, 3, 5, 10, 15]; // minutes

interface Tick {
  last_price: number;
  total_buy_quantity: number;
  total_sell_quantity: number;
  depth: {
    buy: { quantity: number; price: number; orders: number }[];
    sell: { quantity: number; price: number; orders: number }[];
  };
  volume_traded: number;
  received_at: string;
  security_id: number;
}

interface MinuteBucket {
  minute: string;
  price: number;
  obi: number;
  depthImbalance: number;
  spread: number;
  volumeVelocity: number;
  bidPressure: number;
  tickCount: number;
}

function parseTickSafe(line: string): Tick | null {
  try {
    const t = JSON.parse(line);
    if (!t.last_price || !t.depth || !t.received_at) return null;
    return t as Tick;
  } catch {
    return null;
  }
}

function computeOBI(tick: Tick): number {
  const buy = tick.total_buy_quantity || 0;
  const sell = tick.total_sell_quantity || 0;
  if (buy + sell === 0) return 0;
  return (buy - sell) / (buy + sell);
}

function computeDepthImbalance(tick: Tick): number {
  const buyDepth = tick.depth.buy.reduce((sum, l) => sum + l.quantity, 0);
  const sellDepth = tick.depth.sell.reduce((sum, l) => sum + l.quantity, 0);
  if (buyDepth + sellDepth === 0) return 0;
  return (buyDepth - sellDepth) / (buyDepth + sellDepth);
}

function computeSpread(tick: Tick): number {
  const bestBid = tick.depth.buy[0]?.price ?? 0;
  const bestAsk = tick.depth.sell[0]?.price ?? 0;
  if (bestBid === 0 || bestAsk === 0) return 0;
  return (bestAsk - bestBid) / ((bestAsk + bestBid) / 2);
}

function computeBidPressure(tick: Tick): number {
  const l1Bid = tick.depth.buy[0]?.quantity ?? 0;
  const totalBid = tick.depth.buy.reduce((sum, l) => sum + l.quantity, 0);
  if (totalBid === 0) return 0;
  return l1Bid / totalBid;
}

function getMinuteKey(receivedAt: string): string {
  return moment(receivedAt).utcOffset("+05:30").format("YYYY-MM-DDTHH:mm");
}

function bucketTicks(ticks: Tick[]): MinuteBucket[] {
  const map = new Map<string, { prices: number[]; obis: number[]; depths: number[]; spreads: number[]; volumes: number[]; bidPressures: number[] }>();

  for (const tick of ticks) {
    const key = getMinuteKey(tick.received_at);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { prices: [], obis: [], depths: [], spreads: [], volumes: [], bidPressures: [] };
      map.set(key, bucket);
    }
    bucket.prices.push(tick.last_price);
    bucket.obis.push(computeOBI(tick));
    bucket.depths.push(computeDepthImbalance(tick));
    bucket.spreads.push(computeSpread(tick));
    bucket.volumes.push(tick.volume_traded || 0);
    bucket.bidPressures.push(computeBidPressure(tick));
  }

  const buckets: MinuteBucket[] = [];
  for (const [minute, data] of map.entries()) {
    const n = data.prices.length;
    buckets.push({
      minute,
      price: data.prices[n - 1],
      obi: data.obis.reduce((a, b) => a + b, 0) / n,
      depthImbalance: data.depths.reduce((a, b) => a + b, 0) / n,
      spread: data.spreads.reduce((a, b) => a + b, 0) / n,
      volumeVelocity: n > 1 ? (data.volumes[n - 1] - data.volumes[0]) / n : 0,
      bidPressure: data.bidPressures.reduce((a, b) => a + b, 0) / n,
      tickCount: n,
    });
  }

  buckets.sort((a, b) => a.minute.localeCompare(b.minute));
  return buckets;
}

function computeCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function computeDirectionalAccuracy(signals: number[], returns: number[]): number {
  let correct = 0;
  let total = 0;
  for (let i = 0; i < signals.length; i++) {
    if (signals[i] === 0 || returns[i] === 0) continue;
    total++;
    if (Math.sign(signals[i]) === Math.sign(returns[i])) correct++;
  }
  return total === 0 ? 0 : correct / total;
}

// ─── Main ───────────────────────────────────────────────────────────

const dateArg = process.argv[2];
const files = readdirSync(dataDir).filter((f) => {
  if (!f.endsWith(".ndjson")) return false;
  if (f.includes("_stage_") || f.endsWith(".bkp")) return false;
  if (dateArg && !f.includes(dateArg)) return false;
  return true;
});

if (files.length === 0) {
  console.log("No data files found" + (dateArg ? ` for date ${dateArg}` : ""));
  process.exit(0);
}

console.log(`Analyzing ${files.length} files...\n`);

const allResults: {
  symbol: string;
  date: string;
  minutes: number;
  features: Record<string, Record<string, { correlation: number; accuracy: number }>>;
}[] = [];

for (const fileName of files) {
  const filePath = resolve(dataDir, fileName);
  const content = readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  const ticks = lines.map(parseTickSafe).filter(Boolean) as Tick[];

  if (ticks.length < 100) continue;

  const match = fileName.match(/^(.+?)_(\d+)_(\d{4}-\d{2}-\d{2})\.ndjson$/);
  const symbol = match ? `${match[1]}_${match[2]}` : fileName;
  const date = match ? match[3] : "unknown";

  const buckets = bucketTicks(ticks);
  if (buckets.length < 20) continue;

  const featureResults: Record<string, Record<string, { correlation: number; accuracy: number }>> = {};

  for (const window of FORWARD_WINDOWS) {
    const windowKey = `${window}min`;
    const pairs: { obi: number; depth: number; spread: number; volume: number; bidPressure: number; ret: number }[] = [];

    for (let i = 0; i < buckets.length - window; i++) {
      const current = buckets[i];
      const future = buckets[i + window];
      if (!future || current.price === 0) continue;
      const ret = (future.price - current.price) / current.price;
      pairs.push({
        obi: current.obi,
        depth: current.depthImbalance,
        spread: current.spread,
        volume: current.volumeVelocity,
        bidPressure: current.bidPressure,
        ret,
      });
    }

    if (pairs.length < 10) continue;

    const returns = pairs.map((p) => p.ret);
    const features = {
      OBI: pairs.map((p) => p.obi),
      DepthImbalance: pairs.map((p) => p.depth),
      Spread: pairs.map((p) => p.spread),
      VolumeVelocity: pairs.map((p) => p.volume),
      BidPressure: pairs.map((p) => p.bidPressure),
    };

    for (const [featureName, values] of Object.entries(features)) {
      if (!featureResults[featureName]) featureResults[featureName] = {};
      featureResults[featureName][windowKey] = {
        correlation: computeCorrelation(values, returns),
        accuracy: computeDirectionalAccuracy(values, returns),
      };
    }
  }

  allResults.push({ symbol, date, minutes: buckets.length, features: featureResults });
}

// ─── Output ─────────────────────────────────────────────────────────

if (allResults.length === 0) {
  console.log("Not enough data for analysis.");
  process.exit(0);
}

for (const result of allResults) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`${result.symbol} | ${result.date} | ${result.minutes} minutes of data`);
  console.log(`${"═".repeat(60)}`);

  const featureNames = Object.keys(result.features);
  const windowKeys = FORWARD_WINDOWS.map((w) => `${w}min`);

  // Header
  console.log(`${"Feature".padEnd(18)}${windowKeys.map((w) => w.padStart(12)).join("")}`);
  console.log(`${" ".repeat(18)}${windowKeys.map(() => "corr / acc".padStart(12)).join("")}`);
  console.log("-".repeat(18 + windowKeys.length * 12));

  for (const feature of featureNames) {
    const cells = windowKeys.map((w) => {
      const data = result.features[feature]?.[w];
      if (!data) return "    —     ";
      const corr = (data.correlation >= 0 ? "+" : "") + data.correlation.toFixed(3);
      const acc = (data.accuracy * 100).toFixed(1) + "%";
      return `${corr}/${acc}`;
    });
    console.log(`${feature.padEnd(18)}${cells.map((c) => c.padStart(12)).join("")}`);
  }
}

// ─── Summary ────────────────────────────────────────────────────────

console.log(`\n\n${"═".repeat(60)}`);
console.log("AGGREGATE SUMMARY");
console.log(`${"═".repeat(60)}`);

const aggFeatures: Record<string, Record<string, { corrs: number[]; accs: number[] }>> = {};

for (const result of allResults) {
  for (const [feature, windows] of Object.entries(result.features)) {
    if (!aggFeatures[feature]) aggFeatures[feature] = {};
    for (const [window, data] of Object.entries(windows)) {
      if (!aggFeatures[feature][window]) aggFeatures[feature][window] = { corrs: [], accs: [] };
      aggFeatures[feature][window].corrs.push(data.correlation);
      aggFeatures[feature][window].accs.push(data.accuracy);
    }
  }
}

const windowKeys = FORWARD_WINDOWS.map((w) => `${w}min`);
console.log(`${"Feature".padEnd(18)}${windowKeys.map((w) => w.padStart(12)).join("")}`);
console.log(`${" ".repeat(18)}${windowKeys.map(() => "corr / acc".padStart(12)).join("")}`);
console.log("-".repeat(18 + windowKeys.length * 12));

for (const [feature, windows] of Object.entries(aggFeatures)) {
  const cells = windowKeys.map((w) => {
    const data = windows[w];
    if (!data || data.corrs.length === 0) return "    —     ";
    const avgCorr = data.corrs.reduce((a, b) => a + b, 0) / data.corrs.length;
    const avgAcc = data.accs.reduce((a, b) => a + b, 0) / data.accs.length;
    const corr = (avgCorr >= 0 ? "+" : "") + avgCorr.toFixed(3);
    const acc = (avgAcc * 100).toFixed(1) + "%";
    return `${corr}/${acc}`;
  });
  console.log(`${feature.padEnd(18)}${cells.map((c) => c.padStart(12)).join("")}`);
}

console.log(`\nFiles analyzed: ${allResults.length}`);
console.log("Accuracy >53% suggests actionable signal. Correlation >|0.05| is meaningful for tick data.");
