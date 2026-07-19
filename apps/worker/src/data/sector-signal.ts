import { OverallVerdict, SectorSignal } from "../types/market-data/quarterly-results-firebase.ts";

const SECTOR_BUCKETS: [string, RegExp][] = [
  ["Banking", /\bBanks?\b/i],
  ["NBFC & Financial Services", /NBFC|Finance\s*-|Financial Services|Investment\s*\//i],
  ["IT & Software", /Computers?\s*-\s*Software|IT Enabled|Information Technology/i],
  ["Pharma & Healthcare", /Pharmaceuticals|Hospitals|Healthcare|Diagnostic/i],
  ["Auto & Ancillaries", /Auto Ancillaries|Automobile/i],
  ["Metals & Mining", /\bSteel\b|Aluminium|\bMining\b|Metal\s*-|Non Ferrous/i],
  ["Energy, Oil & Power", /Power Generation|\bOil\b|\bGas\b|Refineries|Energy\s*-|Power\s*-/i],
  ["FMCG & Consumer", /FMCG|Food\s*-\s*Processing|Personal Care|Consumer|Household/i],
  ["Infrastructure & Construction", /Construction|Engineering\s*-\s*Turnkey|Infrastructure/i],
  ["Chemicals", /Chemicals/i],
  ["Textiles", /Textiles/i],
  ["Realty", /Realty|Real Estate/i],
  ["Telecom & Media", /Telecommunications|Entertainment|Media\b/i],
  ["Cement", /Cement/i],
];

/**
 * Buy-day/sell-day per (sector, verdict), backtested on 447 stocks x 8 quarters (2024-2026) --
 * see the "verdict backtest" analysis. Entry/exit picked as the best-average-return combo among
 * {t0,t1,t3,t5,t10,t20} for that bucket, gated to n>=8, avg return >=1.5%, win rate >=55% --
 * buckets that don't clear the gate are intentionally absent (no signal) rather than showing a
 * losing or noise-level "best of 15 combos" result.
 *
 * Scoped to strong_positive/positive only: the same search over negative/neutral verdicts
 * produced a handful of "buy after bad news" results (e.g. Cement negative, Auto & Ancillaries
 * neutral) that are exactly the shape of a multiple-comparisons false positive (840 combos
 * searched total across all buckets) rather than a real pattern, so those are excluded rather
 * than surfaced as if trustworthy.
 */
const SIGNAL_TABLE: Partial<Record<string, Partial<Record<"strong_positive" | "positive", Omit<SectorSignal, "sector">>>>> = {
  "Auto & Ancillaries": {
    strong_positive: { entryHorizon: "t0", exitHorizon: "t20", avgReturnPct: 3.25, winRatePct: 64, sampleSize: 44 },
  },
  Banking: {
    strong_positive: { entryHorizon: "t0", exitHorizon: "t1", avgReturnPct: 1.61, winRatePct: 57, sampleSize: 42 },
  },
  Chemicals: {
    strong_positive: { entryHorizon: "t0", exitHorizon: "t10", avgReturnPct: 5.1, winRatePct: 67, sampleSize: 42 },
  },
  "Energy, Oil & Power": {
    strong_positive: { entryHorizon: "t0", exitHorizon: "t5", avgReturnPct: 3.94, winRatePct: 69, sampleSize: 29 },
  },
  "FMCG & Consumer": {
    strong_positive: { entryHorizon: "t0", exitHorizon: "t20", avgReturnPct: 6.1, winRatePct: 62, sampleSize: 34 },
  },
  "Infrastructure & Construction": {
    strong_positive: { entryHorizon: "t0", exitHorizon: "t5", avgReturnPct: 2.84, winRatePct: 59, sampleSize: 59 },
  },
  "Metals & Mining": {
    positive: { entryHorizon: "t1", exitHorizon: "t20", avgReturnPct: 1.7, winRatePct: 55, sampleSize: 76 },
    strong_positive: { entryHorizon: "t0", exitHorizon: "t3", avgReturnPct: 2.95, winRatePct: 61, sampleSize: 41 },
  },
  "Pharma & Healthcare": {
    positive: { entryHorizon: "t5", exitHorizon: "t20", avgReturnPct: 1.53, winRatePct: 57, sampleSize: 144 },
    strong_positive: { entryHorizon: "t0", exitHorizon: "t20", avgReturnPct: 7.11, winRatePct: 79, sampleSize: 57 },
  },
  "Telecom & Media": {
    strong_positive: { entryHorizon: "t5", exitHorizon: "t20", avgReturnPct: 8.67, winRatePct: 77, sampleSize: 22 },
  },
  Textiles: {
    strong_positive: { entryHorizon: "t0", exitHorizon: "t20", avgReturnPct: 4.17, winRatePct: 58, sampleSize: 26 },
  },
};

function classifySector(industryName: string): string | null {
  for (const [bucket, pattern] of SECTOR_BUCKETS) {
    if (pattern.test(industryName)) return bucket;
  }
  return null;
}

/** Null if the stock's sector can't be classified, or if that (sector, verdict) never cleared the backtest's gate. */
export default function getSectorSignal(industryName: string | null | undefined, verdict: OverallVerdict): SectorSignal | null {
  if (!industryName || (verdict !== "strong_positive" && verdict !== "positive")) return null;

  const sector = classifySector(industryName);
  if (!sector) return null;

  const entry = SIGNAL_TABLE[sector]?.[verdict];
  if (!entry) return null;

  return { sector, ...entry };
}
