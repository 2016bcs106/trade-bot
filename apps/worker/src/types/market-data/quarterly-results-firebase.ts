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
  description: string;
  pdfUrl: string;
  financials: QuarterlyResultFinancials;
}

export interface QuarterlyResultsSnapshot {
  upcoming: Record<string, UpcomingQuarterlyResultRecord>;
  recent: Record<string, RecentQuarterlyResultRecord>;
  lastUpdated: string;
}
