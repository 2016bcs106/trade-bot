import fetch from "node-fetch";
import { NseEventCalendarEntry } from "../../types/market-data/nse-event-calendar.ts";
import { NseCorporateAnnouncementEntry } from "../../types/market-data/nse-corporate-announcement.ts";

/**
 * NSE (nseindia.com) client — handles the cookie handshake their API requires.
 *
 * NSE's API endpoints reject requests without a valid session cookie, which is
 * only issued by first hitting a regular website page with browser-like headers.
 */
export default class NseClient {
  private readonly baseUrl = "https://www.nseindia.com";
  private readonly userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  private async getSessionCookies(): Promise<string> {
    const response = await fetch(this.baseUrl, {
      headers: {
        "User-Agent": this.userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const setCookie = response.headers.raw()["set-cookie"] ?? [];
    return setCookie.map((c) => c.split(";")[0]).join("; ");
  }

  /**
   * Fetch NSE's corporate event calendar (board meetings — includes upcoming financial results).
   *
   * Without an explicit date range, NSE silently returns some undocumented rolling window rather
   * than "everything from today" — always pass fromDate/toDate (DD-MM-YYYY, e.g. via
   * moment().format("DD-MM-YYYY")), same as the other endpoints below.
   */
  async fetchEventCalendar(index: "equities" | "sme", fromDate: string, toDate: string): Promise<NseEventCalendarEntry[]> {
    const cookies = await this.getSessionCookies();

    const response = await fetch(`${this.baseUrl}/api/event-calendar?index=${index}&from_date=${fromDate}&to_date=${toDate}`, {
      headers: {
        "User-Agent": this.userAgent,
        "Accept": "application/json",
        "Referer": `${this.baseUrl}/companies-listing/corporate-filings-event-calendar`,
        "Cookie": cookies,
      },
    });

    if (!response.ok) {
      throw new Error(`NSE event-calendar request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? (data as NseEventCalendarEntry[]) : [];
  }

  /**
   * Fetch NSE's corporate announcements/disclosures (board meeting outcomes, press releases, etc.)
   * for a date range (DD-MM-YYYY). This feed is live/current — unlike corporates-financial-results,
   * which was found to return stale data regardless of query params.
   */
  async fetchCorporateAnnouncements(index: "equities" | "sme", fromDate: string, toDate: string, symbol?: string): Promise<NseCorporateAnnouncementEntry[]> {
    const cookies = await this.getSessionCookies();
    const symbolParam = symbol ? `&symbol=${encodeURIComponent(symbol)}` : "";

    const response = await fetch(`${this.baseUrl}/api/corporate-announcements?index=${index}&from_date=${fromDate}&to_date=${toDate}${symbolParam}`, {
      headers: {
        "User-Agent": this.userAgent,
        "Accept": "application/json",
        "Referer": `${this.baseUrl}/companies-listing/corporate-filings-announcements`,
        "Cookie": cookies,
      },
    });

    if (!response.ok) {
      throw new Error(`NSE corporate-announcements request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? (data as NseCorporateAnnouncementEntry[]) : [];
  }
}
