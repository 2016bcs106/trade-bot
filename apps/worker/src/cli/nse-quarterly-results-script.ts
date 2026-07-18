import NseClient from "../data/providers/nse-client.ts";
import BseClient from "../data/providers/bse-client.ts";
import FirebaseClient from "../firebase/client.ts";
import { now, nowISO, parseDate } from "../utils/time.ts";
import { QuarterlyResultFinancials, RecentQuarterlyResultRecord, UpcomingQuarterlyResultRecord } from "../types/market-data/quarterly-results-firebase.ts";
import { NseCorporateAnnouncementEntry } from "../types/market-data/nse-corporate-announcement.ts";

const DATE_FORMAT = "DD-MMM-YYYY";
const QUERY_DATE_FORMAT = "DD-MM-YYYY";
const ANNOUNCEMENT_DATE_FORMAT = "DD-MMM-YYYY HH:mm:ss";
const RECENT_DAYS = 7;
const LOOKAHEAD_DAYS = 45;
const BSE_REQUEST_DELAY_MS = 400;

const client = new NseClient();
const bse = new BseClient();

// ─── Upcoming (board meetings scheduled to consider financial results) ───

const calendar = await client.fetchEventCalendar("equities", now().format(QUERY_DATE_FORMAT), now().add(LOOKAHEAD_DAYS, "days").format(QUERY_DATE_FORMAT));
const upcoming = calendar
  .filter((e) => e.purpose.includes("Financial Results"))
  .filter((e) => parseDate(e.date, DATE_FORMAT).isSameOrAfter(now().startOf("day")))
  .sort((a, b) => parseDate(a.date, DATE_FORMAT).valueOf() - parseDate(b.date, DATE_FORMAT).valueOf());

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

const recentCalendar = await client.fetchEventCalendar("equities", now().subtract(RECENT_DAYS, "days").format(QUERY_DATE_FORMAT), now().format(QUERY_DATE_FORMAT));
const financialResultsMeetings = new Set(recentCalendar.filter((e) => e.purpose.includes("Financial Results")).map((e) => `${e.symbol}|${e.date}`));

const announcements = await client.fetchCorporateAnnouncements("equities", now().subtract(RECENT_DAYS, "days").format(QUERY_DATE_FORMAT), now().format(QUERY_DATE_FORMAT));
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

// ─── Print ───

console.log(`Upcoming quarterly results (${upcoming.length})`);
let currentDate: string | null = null;
for (const e of upcoming) {
  if (e.date !== currentDate) {
    currentDate = e.date;
    console.log(`\n${currentDate}`);
  }
  console.log(`  ${e.symbol.padEnd(15)} ${e.company}`);
}

console.log(`\n\nRecently released results — last ${RECENT_DAYS} days (${released.length})`);
for (const a of released) {
  console.log(`\n${a.symbol} — ${a.sm_name}`);
  console.log(`  ${a.an_dt}`);
  console.log(`  ${a.attchmntText}`);
  console.log(`  ${a.attchmntFile}`);
}

// ─── Push to Firebase ───
// financials is a placeholder — nothing populates it yet, see quarterly-results-firebase.ts

const firebase = new FirebaseClient();
const existingUpcoming = ((await firebase.getValue("quarterlyResults/upcoming")) as Record<string, UpcomingQuarterlyResultRecord> | null) ?? {};
const existingRecent = ((await firebase.getValue("quarterlyResults/recent")) as Record<string, RecentQuarterlyResultRecord> | null) ?? {};

const upcomingRecords: Record<string, UpcomingQuarterlyResultRecord> = {};
for (const e of upcoming) {
  upcomingRecords[e.symbol] = { symbol: e.symbol, company: e.company, date: e.date };
}

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// NSE only tells us a result exists — BSE is used to fetch the actual filed result (cleaner
// "Financial Results" category, no text-guessing needed), but only for symbols we haven't
// already fetched (existingRecent) and that have already happened (released is always past,
// never "upcoming"). BSE has no market-wide query, so this is a per-symbol lookup; if BSE
// doesn't have it (not dual-listed, lookup failure), fall back to NSE's own data.

const newlyReleased = released.filter((a) => !existingRecent[a.seq_id]);

const recentRecords: Record<string, RecentQuarterlyResultRecord> = {};
let bseMatched = 0;
let bseFallback = 0;
for (const a of newlyReleased) {
  let description = a.attchmntText;
  let pdfUrl = a.attchmntFile;
  let announcedAt = a.an_dt;

  await delay(BSE_REQUEST_DELAY_MS);
  const scripCode = await bse.findScripCode(a.symbol, a.sm_name);
  if (scripCode) {
    await delay(BSE_REQUEST_DELAY_MS);
    const bseResult = await bse.fetchFinancialResultsAnnouncement(
      scripCode,
      now().subtract(RECENT_DAYS, "days").format(QUERY_DATE_FORMAT),
      now().format(QUERY_DATE_FORMAT)
    );
    if (bseResult) {
      description = bseResult.headline;
      pdfUrl = bseResult.pdfUrl;
      announcedAt = bseResult.announcedAt;
      bseMatched++;
    } else {
      bseFallback++;
    }
  } else {
    bseFallback++;
  }

  recentRecords[a.seq_id] = {
    symbol: a.symbol,
    companyName: a.sm_name,
    announcedAt,
    description,
    pdfUrl,
    financials: emptyFinancials(),
  };
}

// ─── Diff against what's already in Firebase — never overwrite an existing "recent"
// record (it may have had financials filled in since), only add ones that are new.

const updates: Record<string, unknown> = {};
let added = 0;
let updated = 0;
let removed = 0;

const freshUpcomingSymbols = new Set(Object.keys(upcomingRecords));
for (const [symbol, record] of Object.entries(upcomingRecords)) {
  const existing = existingUpcoming[symbol];
  if (!existing) {
    updates[`quarterlyResults/upcoming/${symbol}`] = record;
    added++;
  } else if (existing.date !== record.date || existing.company !== record.company) {
    updates[`quarterlyResults/upcoming/${symbol}`] = record;
    updated++;
  }
}
for (const symbol of Object.keys(existingUpcoming)) {
  if (!freshUpcomingSymbols.has(symbol)) {
    updates[`quarterlyResults/upcoming/${symbol}`] = null;
    removed++;
  }
}

let recentAdded = 0;
for (const [seqId, record] of Object.entries(recentRecords)) {
  if (!existingRecent[seqId]) {
    updates[`quarterlyResults/recent/${seqId}`] = record;
    recentAdded++;
  }
}

if (Object.keys(updates).length > 0) {
  updates["quarterlyResults/lastUpdated"] = nowISO();
  await firebase.updateValues(updates);
}
await firebase.destroy();

console.log(`\n\nFirebase delta — upcoming: +${added} ~${updated} -${removed}, recent: +${recentAdded} (existing recent records left untouched)`);
console.log(`BSE lookups for newly-released results: ${bseMatched} matched, ${bseFallback} fell back to NSE`);
