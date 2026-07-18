import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import createLogger from "../utils/logger.ts";
import { QuarterlyResultFinancials, QuarterlyResultComparison } from "../types/market-data/quarterly-results-firebase.ts";

const execFileAsync = promisify(execFile);
const log = createLogger("financial-extractor");

/**
 * Columns are always [current quarter, prior quarter (QoQ base), same quarter last year (YoY
 * base), year ended]. Requires a decimal point, a comma group, or 2+ digits, so a bare
 * single-digit row-index marker (e.g. the "1." in "1. Income from operations") never matches --
 * those are exactly the kind of stray digit that would otherwise get swept up as if it were a
 * table value.
 */
// The trailing `,?` absorbs a stray comma OCR sometimes glues directly onto a number with no
// separating space (e.g. "458.83," before the next column) -- parseAmount strips it either way.
// It must live inside NUM_TOKEN rather than the column separator, since a separator-level comma
// would be ambiguous with the commas already used for digit-grouping within a single number.
// Leading `\*?` absorbs a footnote-reference asterisk some filers prefix onto EPS figures
// (e.g. "*7.39" marking "not annualised") -- parseAmount's cleanup doesn't need to touch it
// since it's stripped by the parseFloat below rather than kept in the numeric string.
const NUM_TOKEN = String.raw`\*?\(?-?(?:\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d*\.\d+|\d{2,})\)?,?`;

// "(Loss)" is written on either side of "Profit" depending on the filer (e.g. GOACARBON writes
// "Net(Loss) / Profit after tax", most others write "Net Profit / (Loss) for the period"), and
// plenty of filers omit it entirely -- LOSS_PREFIX/LOSS_SUFFIX make it optional in both positions
// rather than accidentally required, which `\(?loss\)?` (parens optional, word "loss" not) was.
const LOSS_PREFIX = String.raw`(?:\(?loss\)?\s*\/?\s*)?`;
const LOSS_SUFFIX = String.raw`(?:\s*\/?\s*\(?loss\)?)?`;

const ROW_PATTERNS: { field: "revenue" | "profitBeforeTax" | "netProfit" | "eps"; labels: RegExp[] }[] = [
  { field: "revenue", labels: [/revenue from operations/i, /net premium earned/i, /total income/i] },
  {
    // The bounded `[^\n]{0,40}` gap covers filers that insert extra words between "profit" and
    // "before tax" (e.g. UNIONBANK: "Profit/(Loss) from Ordinary Activities before Tax").
    field: "profitBeforeTax",
    labels: [new RegExp(`${LOSS_PREFIX}profit${LOSS_SUFFIX}[^\\n]{0,40}before\\s*(?:exceptional items and )?tax`, "i")],
  },
  {
    // Ordered most- to least-specific: HCLTECH/ICICIPRULI drop "net" and "for the period"
    // entirely ("Profit for the period/year", "Profit/(Loss) after tax"), so the last two
    // patterns are deliberately broad -- tried only after the more specific ones fail. The
    // negative lookbehind keeps every variant from matching "Total comprehensive (Loss)/Profit
    // for the period", a later and different figure that happens to also contain "for the
    // period" (seen on GOACARBON, where the real net-profit row uses "after tax" instead).
    field: "netProfit",
    labels: [
      new RegExp(`(?<!comprehensive[^\\n]{0,25})net\\s*${LOSS_PREFIX}profit${LOSS_SUFFIX}\\s*for the (?:period|quarter|year)`, "i"),
      new RegExp(`(?<!comprehensive[^\\n]{0,25})${LOSS_PREFIX}profit${LOSS_SUFFIX}\\s*for the (?:period|quarter|year) after tax`, "i"),
      new RegExp(`(?<!comprehensive[^\\n]{0,25})${LOSS_PREFIX}profit${LOSS_SUFFIX}\\s*for the (?:period|quarter)(?:\\s*\\/\\s*year)?`, "i"),
      new RegExp(`(?<!comprehensive[^\\n]{0,25})${LOSS_PREFIX}profit${LOSS_SUFFIX}\\s*after tax`, "i"),
    ],
  },
  { field: "eps", labels: [/basic[\s\S]{0,80}?\((?:in )?[₹t]\)/i, /earnings per (?:equity )?share[\s\S]{0,120}?basic/i] },
];

// The unit tag is usually printed as its own short line right above the table (e.g. "Z lakhs",
// "₹ in Crore"), but OCR frequently drops the rupee symbol entirely and leaves just the bare
// word -- these patterns don't require a ₹/"in" prefix precisely because of that.
const UNIT_MULTIPLIERS: [RegExp, number][] = [
  [/\blakhs?\b|\blac[s]?\b/i, 1 / 100],
  [/\bcrores?\b/i, 1],
  [/\bmillion\b/i, 1 / 10],
  [/\bbillion\b/i, 100],
];

const VERDICT_THRESHOLD_PCT = 2;

function parseAmount(token: string): number | null {
  const negative = token.includes("(") && token.includes(")");
  const cleaned = token.replace(/[(),*]/g, "");
  // OCR sometimes renders the decimal separator as a period even where commas are the thousands
  // separator (Indian numbering) -- treat only the LAST separator as decimal, strip the rest.
  const lastDot = cleaned.lastIndexOf(".");
  const normalized = lastDot === -1 ? cleaned : cleaned.slice(0, lastDot).replace(/\./g, "") + cleaned.slice(lastDot);
  const value = parseFloat(normalized);
  if (isNaN(value)) return null;
  return negative ? -value : value;
}

/**
 * The unit tag sits immediately above the table (e.g. "Z lakhs" right before the "Particulars"
 * column header), but the surrounding narrative -- a press-release summary, a note about an
 * exceptional item -- often mentions a *different* unit in passing (seen on ICICIPRULI: "...to
 * ₹386 crore..." on the same page as a table actually denominated in billions). Scoping the
 * search to a short window right before the table header avoids picking up those unrelated
 * mentions instead of the table's actual unit.
 */
function detectUnitMultiplier(text: string): number {
  const tableStart = text.search(/particulars/i);
  const windowText = tableStart === -1 ? text : text.slice(Math.max(0, tableStart - 150), tableStart);

  for (const [pattern, multiplier] of UNIT_MULTIPLIERS) {
    if (pattern.test(windowText)) return multiplier;
  }
  // Most quarterly results without an explicit unit tag are already in crores.
  return 1;
}

// Cover letters often mention both terms together in one throwaway sentence ("...the aforesaid
// Consolidated & Standalone Financial Results of the Company are enclosed..."), which would
// otherwise match as if it were the real table title and produce a near-empty slice -- the
// lookahead rules out that joint-mention phrasing so only a genuinely standalone section title matches.
const CONSOLIDATED_HEADER = /\bconsolidated\b(?!\s*(?:&|and)\s*standalone)[^\n]{0,60}\bfinancial results\b/i;
const STANDALONE_HEADER = /\bstandalone\b(?!\s*(?:&|and)\s*consolidated)[^\n]{0,60}\bfinancial results\b/i;

/** Prefer the Consolidated statement's copy of a page if both Standalone and Consolidated tables are present. */
function preferredSection(text: string): string {
  const consolidatedIdx = text.search(CONSOLIDATED_HEADER);
  const standaloneIdx = text.search(STANDALONE_HEADER);

  // Only slice when BOTH a real Standalone and Consolidated section are present -- a
  // single-entity filer with no subsidiaries (e.g. GOACARBON) files only one statement, but its
  // notes often still say "...consolidated financial results are not required..."; treating
  // that lone mention as a section header would slice out the real table that precedes it.
  if (consolidatedIdx === -1 || standaloneIdx === -1) return text;

  return standaloneIdx <= consolidatedIdx ? text.slice(consolidatedIdx) : text.slice(consolidatedIdx, standaloneIdx);
}

// Pipe shows up from OCR misreading table gridlines as a literal character; comma is
// deliberately excluded here since it's already handled inside NUM_TOKEN (see above).
const COLUMN_SEP = String.raw`[\s|]+`;

function findRowValues(text: string, labels: RegExp[]): number[] | null {
  for (const label of labels) {
    const rowRegex = new RegExp(`${label.source}[^\\n]*?(?<nums>(?:${NUM_TOKEN}${COLUMN_SEP}){3}${NUM_TOKEN})`, "i");
    const match = text.match(rowRegex);
    const nums = match?.groups?.nums;
    if (!nums) continue;
    const tokens = nums
      .trim()
      .split(new RegExp(COLUMN_SEP))
      .filter((t) => t.length > 0)
      .map(parseAmount);
    if (tokens.length === 4 && tokens.every((t) => t !== null)) return tokens as number[];
  }
  return null;
}

export function comparison(current: number | null, base: number | null): QuarterlyResultComparison {
  if (current === null || base === null || base === 0) return { verdict: null, pctChange: null };
  const pctChange = ((current - base) / Math.abs(base)) * 100;
  const verdict = pctChange > VERDICT_THRESHOLD_PCT ? "positive" : pctChange < -VERDICT_THRESHOLD_PCT ? "negative" : "neutral";
  return { verdict, pctChange: Math.round(pctChange * 100) / 100 };
}

function detectAuditOpinion(text: string): QuarterlyResultFinancials["auditOpinion"] {
  if (/adverse opinion/i.test(text)) return "adverse";
  if (/disclaimer of opinion/i.test(text)) return "disclaimer";
  if (/qualified (opinion|conclusion)/i.test(text)) return "qualified";
  if (/un(qualified|modified) (opinion|conclusion)/i.test(text)) return "unqualified";
  return null;
}

export function emptyFinancials(): QuarterlyResultFinancials {
  const emptyComparisons = () => ({
    revenue: { verdict: null, pctChange: null },
    netProfit: { verdict: null, pctChange: null },
    operatingMargin: { verdict: null, pctChange: null },
  });

  return {
    overallVerdict: null,
    revenue: null,
    netProfit: null,
    profitBeforeTax: null,
    operatingMarginPct: null,
    eps: null,
    exceptionalItems: null,
    yoy: emptyComparisons(),
    qoq: emptyComparisons(),
    debtToEquityRatio: null,
    interestCoverageRatio: null,
    receivableDays: null,
    inventoryDays: null,
    operatingCashFlow: null,
    freeCashFlow: null,
    returnOnEquityPct: null,
    returnOnCapitalEmployedPct: null,
    sectorMetrics: {
      netInterestMarginPct: null,
      grossNpaPct: null,
      netNpaPct: null,
      provisionCoverageRatioPct: null,
      casaRatioPct: null,
      valueOfNewBusinessMarginPct: null,
      persistencyRatioPct: null,
      constantCurrencyRevenueGrowthPct: null,
      attritionRatePct: null,
      dealTcv: null,
      sameStoreSalesGrowthPct: null,
      volumeGrowthPct: null,
      realizationPerUnit: null,
    },
    auditOpinion: null,
    auditQualificationNotes: null,
    relatedPartyTransactionsFlag: null,
    forwardGuidance: null,
    orderBookValue: null,
    majorDealWins: null,
    revenueEstimateBeat: null,
    profitEstimateBeat: null,
  };
}

async function ocrPage(imageBuffer: Buffer, workDir: string, index: number): Promise<string> {
  const imagePath = join(workDir, `page-${index}.png`);
  await writeFile(imagePath, imageBuffer);
  const { stdout } = await execFileAsync("tesseract", [imagePath, "stdout", "--psm", "3"], { maxBuffer: 1024 * 1024 * 10 });
  return stdout;
}

/**
 * Extracts headline financial figures from the given page images via Tesseract OCR (no LLM) --
 * regex-matches known row labels (Revenue/Total income, PBT, Net profit, Basic EPS) and pulls
 * the four-column [current, QoQ base, YoY base, year-ended] values off each row, then computes
 * yoy/qoq deltas as plain arithmetic. Deliberately leaves every field that requires actual
 * language understanding (auditQualificationNotes, forwardGuidance, sectorMetrics, etc.) as
 * null rather than guess at it from OCR text -- see emptyFinancials(). auditOpinion and
 * overallVerdict are set via simple, explicitly-mechanical rules (documented inline), not
 * holistic judgment.
 */
export default async function extractFinancials(pageImages: Buffer[]): Promise<QuarterlyResultFinancials> {
  const result = emptyFinancials();
  const workDir = await mkdtemp(join(tmpdir(), "financial-ocr-"));
  try {
    const pageTexts = await Promise.all(pageImages.map((buf, i) => ocrPage(buf, workDir, i)));
    const fullText = pageTexts.join("\n");
    const searchText = preferredSection(fullText);
    const unitMultiplier = detectUnitMultiplier(searchText);

    const rows: Partial<Record<"revenue" | "profitBeforeTax" | "netProfit" | "eps", number[]>> = {};
    for (const { field, labels } of ROW_PATTERNS) {
      const values = findRowValues(searchText, labels);
      if (values) rows[field] = values.map((v) => v * (field === "eps" ? 1 : unitMultiplier));
    }

    if (!rows.revenue && !rows.netProfit) {
      log.warn("No recognizable financial rows found in OCR text");
      return result;
    }

    const [revenue, revenueQoqBase, revenueYoyBase] = rows.revenue ?? [null, null, null];
    const [pbt, pbtQoqBase, pbtYoyBase] = rows.profitBeforeTax ?? [null, null, null];
    const [netProfit, netProfitQoqBase, netProfitYoyBase] = rows.netProfit ?? [null, null, null];
    const [eps] = rows.eps ?? [null];

    const round2 = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);
    result.revenue = round2(revenue);
    result.profitBeforeTax = round2(pbt);
    result.netProfit = round2(netProfit);
    result.eps = round2(eps);
    result.operatingMarginPct = revenue && pbt ? round2((pbt / revenue) * 100) : null;

    const marginPct = (rev: number | null, profit: number | null) => (rev && profit ? (profit / rev) * 100 : null);
    result.yoy = {
      revenue: comparison(revenue ?? null, revenueYoyBase ?? null),
      netProfit: comparison(netProfit ?? null, netProfitYoyBase ?? null),
      operatingMargin: comparison(marginPct(revenue ?? null, pbt ?? null), marginPct(revenueYoyBase ?? null, pbtYoyBase ?? null)),
    };
    result.qoq = {
      revenue: comparison(revenue ?? null, revenueQoqBase ?? null),
      netProfit: comparison(netProfit ?? null, netProfitQoqBase ?? null),
      operatingMargin: comparison(marginPct(revenue ?? null, pbt ?? null), marginPct(revenueQoqBase ?? null, pbtQoqBase ?? null)),
    };

    result.auditOpinion = detectAuditOpinion(fullText);

    // Mechanical, not holistic: purely the sign/magnitude of YoY revenue and profit growth.
    // Doesn't account for one-offs, guidance, or sector seasonality the way a language model would.
    const revYoy = result.yoy.revenue.pctChange;
    const profitYoy = result.yoy.netProfit.pctChange;
    if (revYoy !== null && profitYoy !== null) {
      if (revYoy > 15 && profitYoy > 15) result.overallVerdict = "strong_positive";
      else if (revYoy > VERDICT_THRESHOLD_PCT && profitYoy > VERDICT_THRESHOLD_PCT) result.overallVerdict = "positive";
      else if (revYoy < -VERDICT_THRESHOLD_PCT && profitYoy < -VERDICT_THRESHOLD_PCT) result.overallVerdict = "negative";
      else result.overallVerdict = "neutral";
    }

    return result;
  } catch (err) {
    log.warn("OCR-based financial extraction failed", err);
    return result;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
