import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import BaseScript from "./base-script.ts";
import NseClient from "../data/providers/nse-client.ts";
import BseClient from "../data/providers/bse-client.ts";
import { now, nowISO, parseDate } from "../utils/time.ts";
import { QuarterlyResultFinancials, RecentQuarterlyResultRecord, UpcomingQuarterlyResultRecord } from "../types/market-data/quarterly-results-firebase.ts";
import { NseCorporateAnnouncementEntry } from "../types/market-data/nse-corporate-announcement.ts";
import downloadFile from "../utils/download-file.ts";
import locateResultPages from "../data/pdf-locator.ts";
import renderPages, { getPageCount } from "../data/pdf-to-images.ts";
import extractFinancials, { emptyFinancials } from "../data/financial-extractor.ts";
import mapBseFinancialsToResult from "../data/bse-financials-mapper.ts";

const DATE_FORMAT = "DD-MMM-YYYY";
const QUERY_DATE_FORMAT = "DD-MM-YYYY";
const ANNOUNCEMENT_DATE_FORMAT = "DD-MMM-YYYY HH:mm:ss";
const RECENT_DAYS = 7;
const LOOKAHEAD_DAYS = 45;
const BSE_REQUEST_DELAY_MS = 400;
const FULL_DOCUMENT_FALLBACK_MAX_PAGES = 20;

class NseQuarterlyResultsScript extends BaseScript {
  private client = new NseClient();
  private bse = new BseClient();

  private upcomingCount = 0;
  private releasedCount = 0;
  private upcomingAdded = 0;
  private upcomingUpdated = 0;
  private upcomingRemoved = 0;
  private recentAdded = 0;
  private bseMatched = 0;
  private bseFallback = 0;
  private structuredMatched = 0;
  private extracted = 0;
  private extractionFailed = 0;
  private upgraded = 0;

  get scriptName(): string {
    return "nse-quarterly-results";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      "Upcoming": this.upcomingCount,
      "Recently released": this.releasedCount,
      "Upcoming added, updated, removed": `${this.upcomingAdded}, ${this.upcomingUpdated}, ${this.upcomingRemoved}`,
      "Recent added": this.recentAdded,
      "BSE matched, fallback": `${this.bseMatched}, ${this.bseFallback}`,
      "Financials via BSE structured, OCR, OCR failed": `${this.structuredMatched}, ${this.extracted}, ${this.extractionFailed}`,
      "Upgraded to BSE on retry": this.upgraded,
    };
  }

  protected async run(): Promise<void> {
    // ─── Upcoming (board meetings scheduled to consider financial results) ───

    const calendar = await this.client.fetchEventCalendar("equities", now().format(QUERY_DATE_FORMAT), now().add(LOOKAHEAD_DAYS, "days").format(QUERY_DATE_FORMAT));
    const upcoming = calendar
      .filter((e) => e.purpose.includes("Financial Results"))
      .filter((e) => parseDate(e.date, DATE_FORMAT).isSameOrAfter(now().startOf("day")))
      .sort((a, b) => parseDate(a.date, DATE_FORMAT).valueOf() - parseDate(b.date, DATE_FORMAT).valueOf());
    this.upcomingCount = upcoming.length;

    // ─── Recently released (last 7 days) ───
    // corporates-financial-results (the structured XBRL figures feed) was found to return stale data
    // regardless of query params, so this uses corporate-announcements instead — live, but text-only
    // (no figures): "Outcome of Board Meeting" filings whose attachment text mentions financial results.
    //
    // Some companies (e.g. JIOFIN) file that outcome with bare text — just "Outcome of Board Meeting",
    // no mention of "financial results" — so the text check alone misses them. Cross-referencing against
    // the event calendar's "Financial Results" purpose for that symbol+date catches those too. A single
    // symbol+date cross-check isn't precise enough on its own though: companies often bundle several board
    // agenda items (e.g. NUVOCO also filed a separate "appointment of Statutory Auditors" outcome the same
    // day as its real results) — so within each symbol+date group, prefer whichever entries explicitly say
    // "financial results", and only fall back to a bare-text entry when it's the sole filing for that date.

    const recentCalendar = await this.client.fetchEventCalendar("equities", now().subtract(RECENT_DAYS, "days").format(QUERY_DATE_FORMAT), now().format(QUERY_DATE_FORMAT));
    const financialResultsMeetings = new Set(recentCalendar.filter((e) => e.purpose.includes("Financial Results")).map((e) => `${e.symbol}|${e.date}`));

    const announcements = await this.client.fetchCorporateAnnouncements("equities", now().subtract(RECENT_DAYS, "days").format(QUERY_DATE_FORMAT), now().format(QUERY_DATE_FORMAT));
    const boardMeetingOutcomes = announcements.filter((a) => a.desc === "Outcome of Board Meeting");

    const groups = new Map<string, NseCorporateAnnouncementEntry[]>();
    for (const a of boardMeetingOutcomes) {
      const key = `${a.symbol}|${a.an_dt.split(" ")[0]}`;
      const group = groups.get(key) ?? [];
      group.push(a);
      groups.set(key, group);
    }

    const released: NseCorporateAnnouncementEntry[] = [];
    for (const [key, entries] of groups) {
      const explicit = entries.filter((e) => e.attchmntText.toLowerCase().includes("financial results"));
      if (explicit.length > 0) {
        released.push(...explicit);
      } else if (entries.length === 1 && financialResultsMeetings.has(key)) {
        released.push(entries[0]);
      }
    }
    released.sort((a, b) => parseDate(b.an_dt, ANNOUNCEMENT_DATE_FORMAT).valueOf() - parseDate(a.an_dt, ANNOUNCEMENT_DATE_FORMAT).valueOf());
    this.releasedCount = released.length;

    let currentDate: string | null = null;
    for (const e of upcoming) {
      if (e.date !== currentDate) {
        currentDate = e.date;
        this.log.debug(currentDate);
      }
      this.log.debug(`  ${e.symbol.padEnd(15)} ${e.company}`);
    }
    for (const a of released) {
      this.log.debug(`${a.symbol} — ${a.sm_name} | ${a.an_dt} | ${a.attchmntText} | ${a.attchmntFile}`);
    }

    // ─── Push to Firebase ───
    // financials is extracted per newly-released record below, via extractFinancialsFromPdf.

    const existingUpcoming = ((await this.firebase.getValue("quarterlyResults/upcoming")) as Record<string, UpcomingQuarterlyResultRecord> | null) ?? {};
    const existingRecent = ((await this.firebase.getValue("quarterlyResults/recent")) as Record<string, RecentQuarterlyResultRecord> | null) ?? {};

    const upcomingRecords: Record<string, UpcomingQuarterlyResultRecord> = {};
    for (const e of upcoming) {
      upcomingRecords[e.symbol] = { symbol: e.symbol, company: e.company, date: e.date };
    }

    // NSE only tells us a result exists — BSE is used to fetch the actual filed result (cleaner
    // "Financial Results" category, no text-guessing needed), but only for symbols we haven't
    // already fetched (existingRecent) and that have already happened (released is always past,
    // never "upcoming"). BSE has no market-wide query, so this is a per-symbol lookup; if BSE
    // doesn't have it (not dual-listed, lookup failure), fall back to NSE's own data.

    const newlyReleased = released.filter((a) => !existingRecent[a.seq_id]);

    const recentRecords: Record<string, RecentQuarterlyResultRecord> = {};
    for (const a of newlyReleased) {
      // Each company's processing is isolated in its own try/catch: an unexpected failure here
      // (e.g. a transient filesystem error during OCR) must never crash the whole batch, and
      // must never produce a partial record (fields present, financials silently missing --
      // Firebase drops undefined keys on write rather than erroring, which previously let a
      // failed company through with everything except financials/financialsSource). Skipping
      // this company for the run is safe and self-healing: it's simply retried as newlyReleased
      // again next run, since it never gets added to existingRecent.
      try {
        let description = a.attchmntText;
        let pdfUrl = a.attchmntFile;
        let announcedAt = a.an_dt;

        await this.delay(BSE_REQUEST_DELAY_MS);
        const scripCode = await this.bse.findScripCode(a.symbol, a.sm_name);
        if (scripCode) {
          await this.delay(BSE_REQUEST_DELAY_MS);
          const bseResult = await this.bse.fetchFinancialResultsAnnouncement(
            scripCode,
            now().subtract(RECENT_DAYS, "days").format(QUERY_DATE_FORMAT),
            now().format(QUERY_DATE_FORMAT)
          );
          if (bseResult) {
            description = bseResult.headline;
            pdfUrl = bseResult.pdfUrl;
            announcedAt = bseResult.announcedAt;
            this.bseMatched++;
          } else {
            this.bseFallback++;
          }
        } else {
          this.bseFallback++;
        }

        // BSE's own structured financials (see bse-client.ts fetchStructuredFinancials) are
        // exact and instant when available -- no PDF download, no OCR, no row-format guessing.
        // Only fall back to OCR/vision on the filed PDF when BSE has no scrip match or hasn't
        // published structured data for this filing yet.
        await this.delay(BSE_REQUEST_DELAY_MS);
        const structuredFinancials = scripCode ? await this.bse.fetchStructuredFinancials(scripCode) : null;

        let financials: QuarterlyResultFinancials;
        let financialsSource: RecentQuarterlyResultRecord["financialsSource"];
        if (structuredFinancials) {
          financials = mapBseFinancialsToResult(structuredFinancials);
          financialsSource = "bse";
          this.structuredMatched++;
        } else {
          financials = await this.extractFinancialsFromPdf(pdfUrl);
          if (financials.overallVerdict !== null) {
            financialsSource = "ocr";
            this.extracted++;
          } else {
            financialsSource = "none";
            this.extractionFailed++;
          }
        }

        recentRecords[a.seq_id] = {
          symbol: a.symbol,
          companyName: a.sm_name,
          announcedAt,
          announcedAtMs: parseDate(announcedAt, ANNOUNCEMENT_DATE_FORMAT).valueOf(),
          description,
          pdfUrl,
          financials,
          financialsSource,
        };
      } catch (err) {
        this.log.warn(`Skipping ${a.symbol} this run after an unexpected error`, err);
      }
    }

    // ─── Retry BSE for existing records that fell back to OCR (or failed outright) ───
    // BSE's throttling looks transient (companies attempted right after a throttled one tend
    // to succeed immediately -- see bse-client.ts), so a stock that missed BSE in one 5-minute
    // run will very likely succeed on a later one. Only upgrades financials in place when BSE
    // now succeeds; leaves the record untouched otherwise. Scoped to the same RECENT_DAYS
    // window as everything else here, since a stock BSE still doesn't have data for after a
    // week is unlikely to ever get it (not dual-listed) and isn't worth retrying forever.
    const recentCutoffMs = now().subtract(RECENT_DAYS, "days").valueOf();
    const retryableSeqIds = Object.keys(existingRecent).filter(
      (seqId) => existingRecent[seqId].financialsSource !== "bse" && existingRecent[seqId].announcedAtMs >= recentCutoffMs
    );

    const financialsUpgrades: Record<string, RecentQuarterlyResultRecord> = {};
    for (const seqId of retryableSeqIds) {
      try {
        const existing = existingRecent[seqId];

        await this.delay(BSE_REQUEST_DELAY_MS);
        const scripCode = await this.bse.findScripCode(existing.symbol, existing.companyName);
        if (!scripCode) continue;

        await this.delay(BSE_REQUEST_DELAY_MS);
        const structuredFinancials = await this.bse.fetchStructuredFinancials(scripCode);
        if (!structuredFinancials) continue;

        financialsUpgrades[seqId] = { ...existing, financials: mapBseFinancialsToResult(structuredFinancials), financialsSource: "bse" };
        this.upgraded++;
      } catch (err) {
        this.log.warn(`Skipping retry for ${existingRecent[seqId]?.symbol} this run after an unexpected error`, err);
      }
    }

    // ─── Diff against what's already in Firebase — never overwrite an existing "recent"
    // record (it may have had financials filled in since), only add ones that are new.

    const updates: Record<string, unknown> = {};

    const freshUpcomingSymbols = new Set(Object.keys(upcomingRecords));
    for (const [symbol, record] of Object.entries(upcomingRecords)) {
      const existing = existingUpcoming[symbol];
      if (!existing) {
        updates[`quarterlyResults/upcoming/${symbol}`] = record;
        this.upcomingAdded++;
      } else if (existing.date !== record.date || existing.company !== record.company) {
        updates[`quarterlyResults/upcoming/${symbol}`] = record;
        this.upcomingUpdated++;
      }
    }
    for (const symbol of Object.keys(existingUpcoming)) {
      if (!freshUpcomingSymbols.has(symbol)) {
        updates[`quarterlyResults/upcoming/${symbol}`] = null;
        this.upcomingRemoved++;
      }
    }

    for (const [seqId, record] of Object.entries(recentRecords)) {
      if (!existingRecent[seqId]) {
        updates[`quarterlyResults/recent/${seqId}`] = record;
        this.recentAdded++;
      }
    }
    for (const [seqId, record] of Object.entries(financialsUpgrades)) {
      updates[`quarterlyResults/recent/${seqId}`] = record;
    }

    if (Object.keys(updates).length > 0) {
      updates["quarterlyResults/lastUpdated"] = nowISO();
      await this.firebase.updateValues(updates);
    }

    this.log.info(
      `Firebase delta — upcoming: +${this.upcomingAdded} ~${this.upcomingUpdated} -${this.upcomingRemoved}, recent: +${this.recentAdded} ` +
      `(BSE matched: ${this.bseMatched}, fell back to NSE: ${this.bseFallback}, upgraded to BSE on retry: ${this.upgraded})`
    );
  }

  /**
   * Downloads the filed PDF, locates the pages containing the actual results table (see
   * pdf-locator.ts -- avoids vision-reading 40+ pages of subsidiary lists and auditor
   * boilerplate on large filings), and extracts structured financials from just those pages.
   * Falls back to a capped read of the whole document if locating fails outright (e.g. a
   * scanned filing with no usable text layer at all). Any failure degrades to
   * emptyFinancials() rather than throwing, so one bad PDF doesn't stop the sync run.
   */
  private async extractFinancialsFromPdf(pdfUrl: string): Promise<QuarterlyResultFinancials> {
    // mkdtemp itself must be inside the try -- if it throws (e.g. a transient filesystem issue),
    // that previously escaped uncaught since it ran before the try block started, propagating up
    // through the caller instead of degrading to emptyFinancials() like every other failure here.
    let workDir: string | null = null;
    try {
      workDir = await mkdtemp(join(tmpdir(), "quarterly-pdf-"));
      const pdfPath = join(workDir, "filing.pdf");
      await downloadFile(pdfUrl, pdfPath);

      let pages = await locateResultPages(pdfPath);
      if (!pages) {
        const cappedCount = Math.min(await getPageCount(pdfPath), FULL_DOCUMENT_FALLBACK_MAX_PAGES);
        this.log.debug(`No results pages located for ${pdfUrl}, falling back to first ${cappedCount} pages`);
        pages = Array.from({ length: cappedCount }, (_, i) => i + 1);
      }

      const images = await renderPages(pdfPath, pages);
      return await extractFinancials(images);
    } catch (err) {
      this.log.warn(`Financial extraction failed for ${pdfUrl}`, err);
      return emptyFinancials();
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true });
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

new NseQuarterlyResultsScript().start();
