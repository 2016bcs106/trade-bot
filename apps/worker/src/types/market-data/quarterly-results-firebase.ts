export interface QuarterlyResultComparison {
  verdict: "positive" | "negative" | "neutral" | null;
  pctChange: number | null;
}

export interface QuarterlyResultComparisons {
  revenue: QuarterlyResultComparison;
  netProfit: QuarterlyResultComparison;
  operatingMargin: QuarterlyResultComparison;
}

export type AuditOpinionType = "unqualified" | "qualified" | "adverse" | "disclaimer" | null;

/** Holistic call on the quarter, not a mechanical rollup of the fields below — see prior filing reads in this session for how this gets judged. */
export type OverallVerdict = "strong_positive" | "positive" | "neutral" | "negative" | null;

/** Only the fields relevant to a company's sector will ever be non-null. */
export interface SectorMetrics {
  // Banks / NBFCs
  netInterestMarginPct: number | null;
  grossNpaPct: number | null;
  netNpaPct: number | null;
  provisionCoverageRatioPct: number | null;
  casaRatioPct: number | null;
  // Insurance
  valueOfNewBusinessMarginPct: number | null;
  persistencyRatioPct: number | null;
  // IT services
  constantCurrencyRevenueGrowthPct: number | null;
  attritionRatePct: number | null;
  dealTcv: number | null;
  // Retail / FMCG
  sameStoreSalesGrowthPct: number | null;
  volumeGrowthPct: number | null;
  // Auto
  realizationPerUnit: number | null;
}

/** Not populated yet — see nse-quarterly-results-script.ts for how these get filled in. */
export interface QuarterlyResultFinancials {
  // Holistic call — drives the frontend's Recent-tab badge
  overallVerdict: OverallVerdict;

  // Headline P&L
  revenue: number | null;
  netProfit: number | null;
  profitBeforeTax: number | null;
  operatingMarginPct: number | null;
  eps: number | null;
  exceptionalItems: number | null;

  // Period-over-period comparisons
  yoy: QuarterlyResultComparisons;
  qoq: QuarterlyResultComparisons;

  // Balance sheet / leverage
  debtToEquityRatio: number | null;
  interestCoverageRatio: number | null;
  receivableDays: number | null;
  inventoryDays: number | null;

  // Cash flow
  operatingCashFlow: number | null;
  freeCashFlow: number | null;

  // Returns
  returnOnEquityPct: number | null;
  returnOnCapitalEmployedPct: number | null;

  // Sector-specific
  sectorMetrics: SectorMetrics;

  // Qualitative / disclosure-based signals
  auditOpinion: AuditOpinionType;
  auditQualificationNotes: string | null;
  relatedPartyTransactionsFlag: boolean | null;
  forwardGuidance: string | null;
  orderBookValue: number | null;
  majorDealWins: string | null;

  // vs. analyst consensus — no current data source, placeholder for future use
  revenueEstimateBeat: boolean | null;
  profitEstimateBeat: boolean | null;
}

export interface UpcomingQuarterlyResultRecord {
  symbol: string;
  company: string;
  date: string;
}

export interface RecentQuarterlyResultRecord {
  symbol: string;
  companyName: string;
  announcedAt: string;
  /** Unix ms — announcedAt isn't lexicographically sortable ("18-Jul-2026..."), so this is
   * what the frontend range-queries on to filter to the last N days server-side. */
  announcedAtMs: number;
  description: string;
  pdfUrl: string;
  financials: QuarterlyResultFinancials;
  /** Which method actually produced `financials` — "ocr" (or "none") records get retried against
   * BSE's structured feed on later runs, since BSE throttling that caused the fallback is
   * typically transient; "bse" records are left alone. See nse-quarterly-results-script.ts. */
  financialsSource: "bse" | "ocr" | "none";

  /** Price at the exact minute results were announced (via Paytm Money minute OHLCV, using
   * announcedAt as the reference time) if that falls within market hours, otherwise the daily
   * close on the announcement date or the last trading day before it — see price-tracker.ts.
   * Set once and never touched again, since a historical price never changes. Null if no price
   * data was found. */
  releasePrice: number | null;
  /** YYYY-MM-DD of the trading day releasePrice actually came from (may be earlier than
   * announcedAt's date if results were announced outside market hours or on a holiday). */
  releasePriceDate: string | null;
  /** Most recent available close — refreshed each run so this drifts forward day by day rather
   * than staying fixed like releasePrice. */
  latestPrice: number | null;
  /** YYYY-MM-DD of the trading day latestPrice came from. */
  latestPriceDate: string | null;
  /** (latestPrice - releasePrice) / releasePrice * 100. Null unless both prices are available. */
  priceChangePct: number | null;
}

export interface QuarterlyResultsSnapshot {
  upcoming: Record<string, UpcomingQuarterlyResultRecord>;
  recent: Record<string, RecentQuarterlyResultRecord>;
  lastUpdated: string;
}
