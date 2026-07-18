import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

const MARKER_PATTERNS = [
  /statement of (standalone|consolidated|audited|unaudited).{0,60}financial results/i,
  /net profit\s*\/?\s*\(loss\)\s*for the (period|quarter)/i,
  /total income/i,
  /profit before tax/i,
  /earnings per (equity )?share/i,
];

const OCR_FALLBACK_MAX_PAGES = 20;

function findMarkerPages(pageTexts: string[]): number[] {
  const hits: number[] = [];
  pageTexts.forEach((pageText, idx) => {
    const matchCount = MARKER_PATTERNS.filter((p) => p.test(pageText)).length;
    if (matchCount >= 2) hits.push(idx + 1);
  });
  return hits;
}

function bufferPages(hits: number[], totalPages: number): number[] {
  const buffered = new Set<number>();
  for (const h of hits) {
    for (const p of [h - 1, h, h + 1]) {
      if (p >= 1 && p <= totalPages) buffered.add(p);
    }
  }
  return [...buffered].sort((a, b) => a - b);
}

/**
 * `pdftotext`'s digit garbling (seen across the accuracy tests that motivated this module) is
 * confined to numbers — it preserves plain-English table headers even on badly OCR-mangled
 * filings. So this only needs to find PAGES containing the results table, not read the figures
 * off them; the actual extraction happens later via vision on the located pages.
 */
async function locateViaPdftotext(pdfPath: string): Promise<number[] | null> {
  const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], { maxBuffer: 1024 * 1024 * 50 });
  if (stdout.trim().length < 200) return null;

  // pdftotext emits a trailing form-feed after the last page, so a naive split() produces one
  // extra empty segment at the end -- drop it, or downstream page numbers run one past the PDF.
  const pageTexts = stdout.split("\f");
  while (pageTexts.length > 0 && pageTexts[pageTexts.length - 1].trim() === "") pageTexts.pop();

  const hits = findMarkerPages(pageTexts);
  return hits.length > 0 ? bufferPages(hits, pageTexts.length) : null;
}

/**
 * Fallback for the rare case where the PDF's internal text layer is present but its font
 * encoding is broken (digits map correctly, letter glyphs don't — pdftotext then can't match
 * any of the marker phrases even though a human/OCR reading the rendered page sees plain
 * English). Renders each page to an image and OCRs it, since that reads pixels rather than the
 * broken glyph mapping. Capped at OCR_FALLBACK_MAX_PAGES since this only triggers when
 * pdftotext already failed, and NSE/BSE filings are text-based PDFs, not scans — a filing
 * that also blows past this cap is treated as unlocatable rather than burning unbounded OCR time.
 */
async function locateViaOcr(pdfPath: string): Promise<number[] | null> {
  const { stdout: infoOut } = await execFileAsync("pdfinfo", [pdfPath]);
  const pagesMatch = infoOut.match(/^Pages:\s+(\d+)/m);
  if (!pagesMatch) return null;
  const totalPages = Math.min(parseInt(pagesMatch[1], 10), OCR_FALLBACK_MAX_PAGES);

  const workDir = await mkdtemp(join(tmpdir(), "pdf-locate-"));
  try {
    const hits: number[] = [];
    for (let page = 1; page <= totalPages; page++) {
      const imagePrefix = join(workDir, `page-${page}`);
      await execFileAsync("pdftoppm", ["-png", "-r", "150", "-f", String(page), "-l", String(page), "-singlefile", pdfPath, imagePrefix]);
      const { stdout: ocrText } = await execFileAsync("tesseract", [`${imagePrefix}.png`, "stdout", "--psm", "3"], { maxBuffer: 1024 * 1024 * 10 });
      const matchCount = MARKER_PATTERNS.filter((p) => p.test(ocrText)).length;
      if (matchCount >= 2) hits.push(page);
    }
    return hits.length > 0 ? bufferPages(hits, totalPages) : null;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Locates the pages of a quarterly-results PDF that actually contain the financial results
 * table, so extraction only has to vision-read those pages instead of the whole filing
 * (which can run 40+ pages of subsidiary lists and auditor boilerplate). Returns page numbers
 * (1-indexed, ±1 page buffer around each match). Returns null if neither method finds
 * anything — the caller should fall back to a capped full-document read in that case.
 */
export default async function locateResultPages(pdfPath: string): Promise<number[] | null> {
  const viaText = await locateViaPdftotext(pdfPath);
  if (viaText) return viaText;

  return locateViaOcr(pdfPath);
}
