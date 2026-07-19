import { comparison, computeOverallVerdict, emptyFinancials } from "./financial-extractor.ts";
import { BseQuarterlyFinancials } from "../types/market-data/bse-structured-financials.ts";
import { QuarterlyResultFinancials } from "../types/market-data/quarterly-results-firebase.ts";

/**
 * Maps BSE's structured quarterly table (see bse-client.ts fetchStructuredFinancials) onto
 * QuarterlyResultFinancials. Columns are always [current, prior quarter, 2 back, 3 back, same
 * quarter last year, trailing full year] -- position-based, so this holds even when a company
 * hasn't filed its most recent quarter yet (verified on PNB, whose "current" column was still
 * last quarter's filing) since it's the current/prior/YoY *relationship* that matters, not
 * which calendar quarter happens to be first.
 *
 * Same scope as the OCR path (see financial-extractor.ts): only fields BSE actually reports
 * numerically are populated, and overallVerdict is computed via the same shared
 * computeOverallVerdict rule as the OCR fallback -- BSE doesn't give qualitative disclosures
 * (audit opinion, forward guidance, sector ratios), so those stay null here too.
 */
export default function mapBseFinancialsToResult(financials: BseQuarterlyFinancials): QuarterlyResultFinancials {
  const result = emptyFinancials();
  const [current, qoqBase, , , yoyBase, trailingFullYear] = financials.columns;
  if (!current) return result;

  result.revenue = current.revenue;
  result.netProfit = current.netProfit;
  result.profitBeforeTax = current.pbt;
  result.eps = current.eps;
  result.operatingMarginPct = current.operatingMarginPct;
  result.trailingEps = trailingFullYear?.eps ?? null;

  result.yoy = {
    revenue: comparison(current.revenue, yoyBase?.revenue ?? null),
    netProfit: comparison(current.netProfit, yoyBase?.netProfit ?? null),
    operatingMargin: comparison(current.operatingMarginPct, yoyBase?.operatingMarginPct ?? null),
  };
  result.qoq = {
    revenue: comparison(current.revenue, qoqBase?.revenue ?? null),
    netProfit: comparison(current.netProfit, qoqBase?.netProfit ?? null),
    operatingMargin: comparison(current.operatingMarginPct, qoqBase?.operatingMarginPct ?? null),
  };

  result.overallVerdict = computeOverallVerdict(result.netProfit, result.yoy, result.qoq);

  return result;
}
