import BaseScript from "./base-script.ts";
import NseClient from "../data/providers/nse-client.ts";
import BseClient from "../data/providers/bse-client.ts";
import { now, nowISO, parseDate } from "../utils/time.ts";
import { QuarterlyResultFinancials, RecentQuarterlyResultRecord, UpcomingQuarterlyResultRecord } from "../types/market-data/quarterly-results-firebase.ts";
import { NseCorporateAnnouncementEntry } from "../types/market-data/nse-corporate-announcement.ts";

const DATE_FORMAT = "DD-MMM-YYYY";
const QUERY_DATE_FORMAT = "DD-MM-YYYY";
const ANNOUNCEMENT_DATE_FORMAT = "DD-MMM-YYYY HH:mm:ss";
const RECENT_DAYS = 7;
const LOOKAHEAD_DAYS = 45;
const BSE_REQUEST_DELAY_MS = 400;

function emptyFinancials(): QuarterlyResultFinancials {
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
    // financials is a placeholder — nothing populates it yet, see quarterly-results-firebase.ts

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

      recentRecords[a.seq_id] = {
        symbol: a.symbol,
        companyName: a.sm_name,
        announcedAt,
        announcedAtMs: parseDate(announcedAt, ANNOUNCEMENT_DATE_FORMAT).valueOf(),
        description,
        pdfUrl,
        financials: emptyFinancials(),
      };
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

    if (Object.keys(updates).length > 0) {
      updates["quarterlyResults/lastUpdated"] = nowISO();
      await this.firebase.updateValues(updates);
    }

    this.log.info(
      `Firebase delta — upcoming: +${this.upcomingAdded} ~${this.upcomingUpdated} -${this.upcomingRemoved}, recent: +${this.recentAdded} ` +
      `(BSE matched: ${this.bseMatched}, fell back to NSE: ${this.bseFallback})`
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

new NseQuarterlyResultsScript().start();
