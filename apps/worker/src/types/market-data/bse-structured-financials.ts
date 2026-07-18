/** One column of BSE's SlbReportNewbeta quarterly table -- e.g. "Jun-26", or "FY 25-26" for the trailing full-year column. */
export interface BseFinancialsColumn {
  label: string;
  revenue: number | null;
  otherIncome: number | null;
  totalIncome: number | null;
  pbt: number | null;
  tax: number | null;
  netProfit: number | null;
  eps: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
}

/** Columns are ordered [current quarter, prior quarter, 2 quarters back, 3 quarters back, same quarter last year, trailing full year]. */
export interface BseQuarterlyFinancials {
  columns: BseFinancialsColumn[];
}

export interface BseScripSearchResult {
  scripCode: string;
  shortName: string;
  scripName: string;
  type: string;
}
