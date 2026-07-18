import fetch from "node-fetch";
import moment from "moment";
import { BseFinancialResultAnnouncement } from "../../types/market-data/bse-financial-result.ts";
import { BseFinancialsColumn, BseQuarterlyFinancials } from "../../types/market-data/bse-structured-financials.ts";
import retryWithBackoff from "../../utils/retry.ts";
import createLogger from "../../utils/logger.ts";

const log = createLogger("bse-client");

const MAX_RETRIES = 5;

interface BseAnnouncementRow {
  DT_TM: string;
  SUBCATNAME: string;
  HEADLINE: string;
  ATTACHMENTNAME: string;
}

interface BseScripSearchEntry {
  strSricpCode: string;
  shortName: string;
  scripName: string;
  Type: string;
}

type BseFinancialsNumericField = Exclude<keyof BseFinancialsColumn, "label">;

const FINANCIALS_ROW_FIELDS: [string, BseFinancialsNumericField][] = [
  ["Revenue", "revenue"],
  ["Other Income", "otherIncome"],
  ["Total Income", "totalIncome"],
  ["PBT", "pbt"],
  ["Tax", "tax"],
  ["Net Profit", "netProfit"],
  ["EPS", "eps"],
  ["OPM %", "operatingMarginPct"],
  ["NPM %", "netMarginPct"],
];

/**
 * BSE (bseindia.com) client — used only to fetch the actual filed result once NSE has told us
 * a symbol has one. BSE's announcement feed tags "Financial Results" as an explicit category
 * (unlike NSE, which lumps everything under "Outcome of Board Meeting"), so no text-guessing
 * is needed here — but BSE has no market-wide/date-range query, only per-symbol lookups, so it
 * can't be used for discovery.
 */
export default class BseClient {
  private readonly apiBaseUrl = "https://api.bseindia.com/BseIndiaAPI/api";
  private readonly siteBaseUrl = "https://www.bseindia.com";
  private readonly userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  /**
   * Resolve an NSE trading symbol to its BSE scrip code. Returns null if not found (e.g. not
   * dual-listed), not confidently disambiguated, or on any request failure. Every BSE request in
   * this class sets `insecureHTTPParser: true` -- BSE's servers occasionally send a response with
   * whitespace after a header value, which is technically non-compliant and gets rejected outright
   * by Node's default strict HTTP parser ("Parse Error: Unexpected whitespace after header value").
   * Since this is purely an enrichment step with an OCR/vision fallback, any failure here must
   * degrade gracefully rather than take down the whole run.
   *
   * A short symbol search matches multiple unrelated listings — e.g. "PNB" also matches PNB
   * Gilts, PNB Housing Finance, PNB's own bonds/derivatives/T+0 duplicate listing, and even an
   * unrelated bank ETF. Filtering to `Type === "in Equity T+1"` (the primary equity listing,
   * not derivatives/debt/ETFs/T+0 duplicates) plus an exact `shortName` match against the NSE
   * symbol resolves the great majority of cases outright; `companyName` (NSE's own company name)
   * is the tie-breaker on the rare case that still leaves more than one candidate.
   *
   * BSE's servers also intermittently send a transient non-OK response under sustained load --
   * retryWithBackoff retries both that and the malformed-header case (in case insecureHTTPParser
   * alone doesn't fully avoid it) up to MAX_RETRIES times before this gives up and returns null;
   * a genuinely-empty search result (no candidates) is not retried, since retrying wouldn't change
   * that.
   */
  async findScripCode(symbol: string, companyName: string): Promise<string | null> {
    try {
      const entries = await retryWithBackoff(async () => {
        const response = await fetch(`${this.apiBaseUrl}/GetQuoteAllSearchDatabeta/w?searchString=${encodeURIComponent(symbol)}`, {
          headers: { "User-Agent": this.userAgent, "Referer": `${this.siteBaseUrl}/` },
          insecureHTTPParser: true,
        });
        if (!response.ok) throw new Error(`BSE scrip search failed: ${response.status}`);
        return (await response.json()) as BseScripSearchEntry[];
      }, MAX_RETRIES);

      const equityCandidates = entries.filter((e) => e.Type === "in Equity T+1" && e.shortName.toUpperCase() === symbol.toUpperCase());

      if (equityCandidates.length === 0) {
        log.info(`No BSE equity match for ${symbol} (${entries.length} raw candidates)`);
        return null;
      }
      if (equityCandidates.length === 1) return equityCandidates[0].strSricpCode;

      const normalizedTarget = this.normalizeCompanyName(companyName);
      const exactMatch = equityCandidates.find((c) => this.normalizeCompanyName(c.scripName) === normalizedTarget);
      if (!exactMatch) {
        log.info(`${equityCandidates.length} BSE equity candidates for ${symbol}, none matched company name "${companyName}"`);
      }
      return exactMatch ? exactMatch.strSricpCode : null;
    } catch (err) {
      log.error(`findScripCode failed for ${symbol} after retries`, err);
      return null;
    }
  }

  /**
   * Fetches BSE's own structured quarterly financials for a scrip — Revenue, PBT, Net Profit,
   * EPS, margins etc. across the current + 4 prior quarters plus trailing full year, all
   * pre-computed by BSE from the filed results. Verified against known-good filings across
   * bank, IT, auto-components, and NBFC sectors with exact figures and no staleness (unlike
   * `corporates-financial-results` on the NSE side). Returns null if BSE has no data for this
   * scrip yet (e.g. the quarter hasn't been filed) or on any request failure (after retrying
   * transient failures -- see findScripCode) — the caller should fall back to OCR/vision
   * extraction on the filed PDF in that case.
   */
  async fetchStructuredFinancials(scripCode: string): Promise<BseQuarterlyFinancials | null> {
    try {
      const html = await retryWithBackoff(async () => {
        const response = await fetch(`${this.apiBaseUrl}/SlbReportNewbeta/w?scripcode=${scripCode}`, {
          headers: { "User-Agent": this.userAgent, "Referer": `${this.siteBaseUrl}/` },
          insecureHTTPParser: true,
        });
        if (!response.ok) throw new Error(`BSE structured financials request failed: ${response.status}`);
        const data = (await response.json()) as { QtlyinCr?: string };
        return data.QtlyinCr;
      }, MAX_RETRIES);
      if (!html) {
        log.info(`No structured financials HTML from BSE for scripCode=${scripCode}`);
        return null;
      }

      const headerMatch = html.match(/<thead>.*?<\/thead>/s);
      const labels = [...(headerMatch?.[0].matchAll(/<th class='tableheading'>([^<]*)<\/th>/g) ?? [])].map((m) => m[1]).filter((l) => l !== "(in Cr.)");
      if (labels.length === 0) {
        log.info(`No table headers parsed from BSE structured financials HTML for scripCode=${scripCode}`);
        return null;
      }

      const columns: BseFinancialsColumn[] = labels.map((label) => ({
        label,
        revenue: null,
        otherIncome: null,
        totalIncome: null,
        pbt: null,
        tax: null,
        netProfit: null,
        eps: null,
        operatingMarginPct: null,
        netMarginPct: null,
      }));

      const rowPattern = /<td[^>]*>([^<]*)<\/td>(.*?)<\/tr>/g;
      for (const rowMatch of html.matchAll(rowPattern)) {
        const rowLabel = rowMatch[1].trim();
        const field = FINANCIALS_ROW_FIELDS.find(([label]) => label === rowLabel)?.[1];
        if (!field) continue;

        const values = [...rowMatch[2].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => this.parseBseNumber(m[1]));
        values.forEach((value, i) => {
          if (columns[i]) columns[i][field] = value;
        });
      }

      if (columns.every((c) => c.revenue === null && c.netProfit === null)) {
        log.info(`Parsed BSE structured financials columns for scripCode=${scripCode} but all revenue/netProfit values were empty`);
        return null;
      }
      return { columns };
    } catch (err) {
      log.error(`fetchStructuredFinancials failed for scripCode=${scripCode} after retries`, err);
      return null;
    }
  }

  private parseBseNumber(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "--") return null;
    const value = parseFloat(trimmed.replace(/,/g, ""));
    return isNaN(value) ? null : value;
  }

  private normalizeCompanyName(name: string): string {
    return name
      .toUpperCase()
      .replace(/\bLIMITED\b/g, "")
      .replace(/\bLTD\.?\b/g, "")
      .replace(/[^A-Z0-9]/g, "");
  }

  /** Fetch the "Financial Results" categorized announcement for a scrip within a date range (DD-MM-YYYY), if any. Null on failure (after retrying transient failures) — see findScripCode. */
  async fetchFinancialResultsAnnouncement(scripCode: string, fromDate: string, toDate: string): Promise<BseFinancialResultAnnouncement | null> {
    try {
      const from = moment(fromDate, "DD-MM-YYYY").format("YYYYMMDD");
      const to = moment(toDate, "DD-MM-YYYY").format("YYYYMMDD");

      const data = await retryWithBackoff(async () => {
        const response = await fetch(
          `${this.apiBaseUrl}/AnnSubCategoryGetData/w?strCat=-1&strPrevDate=${from}&strScrip=${scripCode}&strSearch=P&strToDate=${to}&strType=C`,
          { headers: { "User-Agent": this.userAgent, "Referer": `${this.siteBaseUrl}/corporates/ann.html` }, insecureHTTPParser: true }
        );
        if (!response.ok) throw new Error(`BSE announcements request failed: ${response.status}`);
        return (await response.json()) as { Table?: BseAnnouncementRow[] };
      }, MAX_RETRIES);

      const resultRows = (data.Table ?? []).filter((r) => r.SUBCATNAME === "Financial Results");
      if (resultRows.length === 0) {
        log.info(`No "Financial Results" announcement from BSE for scripCode=${scripCode} in [${fromDate}, ${toDate}] (${data.Table?.length ?? 0} total rows)`);
        return null;
      }

      resultRows.sort((a, b) => moment(b.DT_TM).valueOf() - moment(a.DT_TM).valueOf());
      const best = resultRows[0];

      return {
        headline: best.HEADLINE,
        announcedAt: moment(best.DT_TM).format("DD-MMM-YYYY HH:mm:ss"),
        pdfUrl: `${this.siteBaseUrl}/xml-data/corpfiling/AttachLive/${best.ATTACHMENTNAME}`,
      };
    } catch (err) {
      log.error(`fetchFinancialResultsAnnouncement failed for scripCode=${scripCode} after retries`, err);
      return null;
    }
  }
}
