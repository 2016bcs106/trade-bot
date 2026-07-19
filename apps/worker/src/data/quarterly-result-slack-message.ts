import { RecentQuarterlyResultRecord } from "../types/market-data/quarterly-results-firebase.ts";

// Same URL formats used by the frontend's FinancialsDetailSheet -- see apps/frontend/src/pages/
// quarterly-results/components/FinancialsDetailSheet.jsx.
const ZERODHA_CHART_ID = "6401";

const VERDICT_LABELS: Record<string, string> = {
  strong_positive: "Strong Positive",
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

const VERDICT_COLORS: Record<string, string> = {
  strong_positive: "#0B8043",
  positive: "#2EB67D",
  neutral: "#94A3B8",
  negative: "#E01E5A",
};

const VERDICT_EMOJI: Record<string, string> = {
  strong_positive: ":large_green_square: ",
  positive: ":large_green_square: ",
  negative: ":large_red_square: ",
};

const AUDIT_OPINION_LABELS: Record<string, string> = {
  unqualified: "Unqualified",
  qualified: "Qualified",
  adverse: "Adverse",
  disclaimer: "Disclaimer",
};

const FINANCIALS_SOURCE_LABELS: Record<string, string> = {
  bse: "BSE",
  ocr: "OCR",
  none: "NONE",
};

const SECTOR_METRIC_LABELS: Record<string, string> = {
  netInterestMarginPct: "Net Interest Margin",
  grossNpaPct: "Gross NPA",
  netNpaPct: "Net NPA",
  provisionCoverageRatioPct: "Provision Coverage Ratio",
  casaRatioPct: "CASA Ratio",
  valueOfNewBusinessMarginPct: "VNB Margin",
  persistencyRatioPct: "Persistency Ratio",
  constantCurrencyRevenueGrowthPct: "CC Revenue Growth",
  attritionRatePct: "Attrition Rate",
  dealTcv: "Deal TCV",
  sameStoreSalesGrowthPct: "Same Store Sales Growth",
  volumeGrowthPct: "Volume Growth",
  realizationPerUnit: "Realization / Unit",
};

type MrkdwnField = { type: "mrkdwn"; text: string };

const has = (v: unknown): boolean => v !== null && v !== undefined;
const crores = (v: number | null | undefined) => (has(v) ? `₹${v!.toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr` : "-");
const pct = (v: number | null | undefined) => (has(v) ? `${v!.toFixed(2)}%` : "-");

// Custom workspace emoji (not standard Unicode -- Slack has no built-in colored-triangle pair).
function directionIndicator(v: number): string {
  if (v > 0) return ":up-green-triangle: ";
  if (v < 0) return ":down-red-triangle: ";
  return "";
}

const signedPct = (v: number | null | undefined) => (has(v) ? `${directionIndicator(v!)}${v! > 0 ? "+" : ""}${v!.toFixed(2)}%` : "-");
const ratio = (v: number | null | undefined) => (has(v) ? v!.toFixed(2) : "-");
const days = (v: number | null | undefined) => (has(v) ? `${v} days` : "-");
const bool = (v: boolean | null | undefined) => (has(v) ? (v ? "Yes" : "No") : "-");
const hasComparison = (c: { pctChange: number | null } | null | undefined) => has(c?.pctChange);

function field(label: string, value: string): MrkdwnField {
  return { type: "mrkdwn", text: `*${label}*\n${value}` };
}

// Slack caps a section at 10 fields -- chunk defensively even though none of our sections here get close.
function fieldsSections(fields: MrkdwnField[]): unknown[] {
  const chunks: MrkdwnField[][] = [];
  for (let i = 0; i < fields.length; i += 10) chunks.push(fields.slice(i, i + 10));
  return chunks.map((chunk) => ({ type: "section", fields: chunk }));
}

function sectionHeader(text: string): unknown {
  return { type: "section", text: { type: "mrkdwn", text: `*${text}*` } };
}

/**
 * Builds a Slack Block Kit message mirroring every section of the frontend's
 * FinancialsDetailSheet bottom sheet -- same fields, same "only show a section if it has data"
 * gating -- plus broker deep links (Zerodha always, Paytm Money only if pmlId was resolved).
 * `color` is meant to be passed to sendSlackBlocks() to render as the message's side-bar.
 *
 * `eventLabel` distinguishes the two notification moments this can be used for -- see
 * nse-quarterly-results-script.ts: "Quarterly Result Released" fires once, the moment the
 * announcement is first discovered (financials may still be OCR-quality or missing at that
 * point); "Financials Updated" fires separately, only for records that upgrade from OCR/none to
 * BSE's structured data on a later run.
 */
export function buildQuarterlyResultBlocks(record: RecentQuarterlyResultRecord, eventLabel = "Quarterly Result Released"): { color: string; blocks: unknown[] } {
  const f = record.financials;
  const verdict = `${f.overallVerdict ? VERDICT_EMOJI[f.overallVerdict] ?? "" : ""}${f.overallVerdict ? VERDICT_LABELS[f.overallVerdict] : "Pending"}`;
  const color = f.overallVerdict ? VERDICT_COLORS[f.overallVerdict] : VERDICT_COLORS.neutral;

  const actionElements: unknown[] = [
    { type: "button", text: { type: "plain_text", text: "View Filing" }, url: record.pdfUrl },
    { type: "button", text: { type: "plain_text", text: "Zerodha" }, url: `https://kite.zerodha.com/markets/chart/web/ciq/NSE/${record.symbol}/${ZERODHA_CHART_ID}` },
  ];
  if (record.pmlId) {
    actionElements.push({ type: "button", text: { type: "plain_text", text: "Paytm Money" }, url: `https://www.paytmmoney.com/stocks/company/${record.pmlId}` });
  }

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: `${eventLabel}: ${record.symbol}` } },
    { type: "section", text: { type: "mrkdwn", text: `*${record.companyName}*\nAnnounced ${record.announcedAt}` } },
    { type: "actions", elements: actionElements },
  ];

  const overviewFields = [
    field("Verdict", verdict),
    field("Audit Opinion", f.auditOpinion ? AUDIT_OPINION_LABELS[f.auditOpinion] : "-"),
    field("Data Source", FINANCIALS_SOURCE_LABELS[record.financialsSource] ?? "-"),
  ];
  if (has(record.latestPrice)) overviewFields.push(field("Latest Price", `₹${record.latestPrice!.toFixed(2)}`));
  blocks.push({ type: "divider" }, sectionHeader("Overview"), ...fieldsSections(overviewFields));

  const hasProfitLoss = has(f.revenue) || has(f.profitBeforeTax) || has(f.netProfit) || has(f.operatingMarginPct) || has(f.eps) || has(f.exceptionalItems);
  if (hasProfitLoss) {
    blocks.push(
      { type: "divider" },
      sectionHeader("Profit & Loss"),
      ...fieldsSections([
        field("Revenue", crores(f.revenue)),
        field("Profit Before Tax", crores(f.profitBeforeTax)),
        field("Net Profit", crores(f.netProfit)),
        field("Operating Margin", pct(f.operatingMarginPct)),
        field("EPS", has(f.eps) ? `₹${f.eps!.toFixed(2)}` : "-"),
        field("Exceptional Items", crores(f.exceptionalItems)),
      ])
    );
  }

  const hasYoy = hasComparison(f.yoy?.revenue) || hasComparison(f.yoy?.netProfit) || hasComparison(f.yoy?.operatingMargin);
  if (hasYoy) {
    blocks.push(
      { type: "divider" },
      sectionHeader("Year-on-Year"),
      ...fieldsSections([
        field("Revenue", signedPct(f.yoy?.revenue?.pctChange)),
        field("Net Profit", signedPct(f.yoy?.netProfit?.pctChange)),
        field("Operating Margin", signedPct(f.yoy?.operatingMargin?.pctChange)),
      ])
    );
  }

  const hasQoq = hasComparison(f.qoq?.revenue) || hasComparison(f.qoq?.netProfit) || hasComparison(f.qoq?.operatingMargin);
  if (hasQoq) {
    blocks.push(
      { type: "divider" },
      sectionHeader("Quarter-on-Quarter"),
      ...fieldsSections([
        field("Revenue", signedPct(f.qoq?.revenue?.pctChange)),
        field("Net Profit", signedPct(f.qoq?.netProfit?.pctChange)),
        field("Operating Margin", signedPct(f.qoq?.operatingMargin?.pctChange)),
      ])
    );
  }

  const hasBalanceSheet =
    has(f.debtToEquityRatio) || has(f.interestCoverageRatio) || has(f.receivableDays) ||
    has(f.inventoryDays) || has(f.returnOnEquityPct) || has(f.returnOnCapitalEmployedPct);
  if (hasBalanceSheet) {
    blocks.push(
      { type: "divider" },
      sectionHeader("Balance Sheet & Returns"),
      ...fieldsSections([
        field("Debt to Equity", ratio(f.debtToEquityRatio)),
        field("Interest Coverage", ratio(f.interestCoverageRatio)),
        field("Receivable Days", days(f.receivableDays)),
        field("Inventory Days", days(f.inventoryDays)),
        field("Return on Equity", pct(f.returnOnEquityPct)),
        field("Return on Capital Employed", pct(f.returnOnCapitalEmployedPct)),
      ])
    );
  }

  if (has(f.operatingCashFlow) || has(f.freeCashFlow)) {
    blocks.push(
      { type: "divider" },
      sectionHeader("Cash Flow"),
      ...fieldsSections([field("Operating Cash Flow", crores(f.operatingCashFlow)), field("Free Cash Flow", crores(f.freeCashFlow))])
    );
  }

  const sectorMetricEntries = Object.entries(f.sectorMetrics ?? {}).filter(([, value]) => has(value));
  if (sectorMetricEntries.length > 0) {
    blocks.push(
      { type: "divider" },
      sectionHeader("Sector Metrics"),
      ...fieldsSections(
        sectorMetricEntries.map(([key, value]) => field(SECTOR_METRIC_LABELS[key] ?? key, key.endsWith("Pct") ? pct(value as number) : crores(value as number)))
      )
    );
  }

  const hasDisclosures = !!f.auditQualificationNotes || has(f.relatedPartyTransactionsFlag) || !!f.forwardGuidance || has(f.orderBookValue) || !!f.majorDealWins;
  if (hasDisclosures) {
    const disclosureFields: MrkdwnField[] = [];
    if (f.auditQualificationNotes) disclosureFields.push(field("Audit Qualification", f.auditQualificationNotes));
    if (has(f.relatedPartyTransactionsFlag)) disclosureFields.push(field("Related Party Transactions", bool(f.relatedPartyTransactionsFlag)));
    if (f.forwardGuidance) disclosureFields.push(field("Forward Guidance", f.forwardGuidance));
    if (has(f.orderBookValue)) disclosureFields.push(field("Order Book", crores(f.orderBookValue)));
    if (f.majorDealWins) disclosureFields.push(field("Major Deal Wins", f.majorDealWins));
    blocks.push({ type: "divider" }, sectionHeader("Disclosures"), ...fieldsSections(disclosureFields));
  }

  if (has(f.revenueEstimateBeat) || has(f.profitEstimateBeat)) {
    blocks.push(
      { type: "divider" },
      sectionHeader("vs. Estimates"),
      ...fieldsSections([field("Revenue Beat", bool(f.revenueEstimateBeat)), field("Profit Beat", bool(f.profitEstimateBeat))])
    );
  }

  return { color, blocks };
}
