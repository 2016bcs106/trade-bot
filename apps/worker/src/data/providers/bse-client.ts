import fetch from "node-fetch";
import moment from "moment";
import { BseFinancialResultAnnouncement } from "../../types/market-data/bse-financial-result.ts";

interface BseAnnouncementRow {
  DT_TM: string;
  SUBCATNAME: string;
  HEADLINE: string;
  ATTACHMENTNAME: string;
}

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
   * dual-listed), not confidently disambiguated, or on any request failure. BSE's servers
   * occasionally send a malformed header that Node's strict HTTP parser rejects outright
   * (observed on PNB); since this is purely an enrichment step with an NSE fallback, any
   * failure here must degrade gracefully rather than take down the whole run.
   *
   * BSE's search tags multiple distinct companies with the same short symbol — e.g. "PNB"
   * matches PNB Gilts Ltd, Punjab National Bank, AND PNB Housing Finance. Taking the first
   * match silently picked the wrong one. `companyName` (NSE's own company name for the
   * symbol) disambiguates via normalized-name equality; with no confident match among
   * multiple candidates, this returns null rather than guessing.
   */
  async findScripCode(symbol: string, companyName: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/PeerSmartSearch/w?Type=SS&text=${encodeURIComponent(symbol)}`, {
        headers: { "User-Agent": this.userAgent, "Referer": `${this.siteBaseUrl}/` },
      });
      if (!response.ok) return null;

      // The response body is a JSON-encoded string (a quoted HTML fragment), not raw HTML —
      // response.text() would return the literal JSON text with escaped `\"` characters.
      const html = (await response.json()) as string;
      const entryPattern = /liclick\('(\d+)','([^']*)'\)"[^>]*><a>.*?<strong>([^<]+)<\/strong>/g;

      const candidates: { scripCode: string; bseName: string }[] = [];
      for (const match of html.matchAll(entryPattern)) {
        const [, scripCode, bseName, matchedSymbol] = match;
        if (matchedSymbol.trim().toUpperCase() === symbol.toUpperCase()) {
          candidates.push({ scripCode, bseName });
        }
      }

      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0].scripCode;

      const normalizedTarget = this.normalizeCompanyName(companyName);
      const exactMatch = candidates.find((c) => this.normalizeCompanyName(c.bseName) === normalizedTarget);
      return exactMatch ? exactMatch.scripCode : null;
    } catch {
      return null;
    }
  }

  private normalizeCompanyName(name: string): string {
    return name
      .toUpperCase()
      .replace(/\bLIMITED\b/g, "")
      .replace(/\bLTD\.?\b/g, "")
      .replace(/[^A-Z0-9]/g, "");
  }

  /** Fetch the "Financial Results" categorized announcement for a scrip within a date range (DD-MM-YYYY), if any. Null on failure — see findScripCode. */
  async fetchFinancialResultsAnnouncement(scripCode: string, fromDate: string, toDate: string): Promise<BseFinancialResultAnnouncement | null> {
    try {
      const from = moment(fromDate, "DD-MM-YYYY").format("YYYYMMDD");
      const to = moment(toDate, "DD-MM-YYYY").format("YYYYMMDD");

      const response = await fetch(
        `${this.apiBaseUrl}/AnnSubCategoryGetData/w?strCat=-1&strPrevDate=${from}&strScrip=${scripCode}&strSearch=P&strToDate=${to}&strType=C`,
        { headers: { "User-Agent": this.userAgent, "Referer": `${this.siteBaseUrl}/corporates/ann.html` } }
      );
      if (!response.ok) return null;

      const data = (await response.json()) as { Table?: BseAnnouncementRow[] };
      const resultRows = (data.Table ?? []).filter((r) => r.SUBCATNAME === "Financial Results");
      if (resultRows.length === 0) return null;

      resultRows.sort((a, b) => moment(b.DT_TM).valueOf() - moment(a.DT_TM).valueOf());
      const best = resultRows[0];

      return {
        headline: best.HEADLINE,
        announcedAt: moment(best.DT_TM).format("DD-MMM-YYYY HH:mm:ss"),
        pdfUrl: `${this.siteBaseUrl}/xml-data/corpfiling/AttachLive/${best.ATTACHMENTNAME}`,
      };
    } catch {
      return null;
    }
  }
}
