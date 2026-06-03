import "../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { readdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, unlinkSync } from "fs";
import moment from "moment";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "..", "..", "..", "..", "data");

const MARKET_START = 9 * 60 + 15;
const MARKET_END = 15 * 60 + 30;

function isMarketHours(receivedAt: string): boolean {
  const m = moment(receivedAt).utcOffset("+05:30");
  const day = m.day();
  if (day === 0 || day === 6) return false;
  const minutes = m.hours() * 60 + m.minutes();
  return minutes >= MARKET_START && minutes <= MARKET_END;
}

function getDateFromReceivedAt(receivedAt: string): string {
  return moment(receivedAt).utcOffset("+05:30").format("YYYY-MM-DD");
}

function getStageFileName(originalName: string, date: string): string {
  const match = originalName.match(/^(.+?)_\d{4}-\d{2}-\d{2}\.ndjson$/);
  if (!match) return `unknown_${date}_stage_1.ndjson`;
  return `${match[1]}_${date}_stage_1.ndjson`;
}

// ─── Pass 1: Scatter valid ticks to staged files ────────────────────

const sourceFiles = readdirSync(dataDir).filter(
  (f) => f.endsWith(".ndjson") && !f.includes("_stage_") && !f.endsWith(".bkp")
);

console.log(`Pass 1: Processing ${sourceFiles.length} source files`);

let totalTicks = 0;
let discarded = 0;
let kept = 0;

for (const fileName of sourceFiles) {
  const filePath = resolve(dataDir, fileName);
  const content = readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  if (lines.length === 0) {
    renameSync(filePath, filePath + ".bkp");
    continue;
  }

  for (const line of lines) {
    totalTicks++;
    try {
      const tick = JSON.parse(line);
      const receivedAt = tick.received_at;
      if (!receivedAt || !isMarketHours(receivedAt)) {
        discarded++;
        continue;
      }

      const date = getDateFromReceivedAt(receivedAt);
      const stageFile = getStageFileName(fileName, date);
      appendFileSync(resolve(dataDir, stageFile), line + "\n");
      kept++;
    } catch {
      discarded++;
    }
  }

  renameSync(filePath, filePath + ".bkp");
  console.log(`  ${fileName} → .bkp (${lines.length} ticks processed)`);
}

console.log(`\nPass 1 complete — kept=${kept} discarded=${discarded} total=${totalTicks}`);

// ─── Pass 2: Sort, dedupe, and finalize staged files ────────────────

const stageFiles = readdirSync(dataDir).filter((f) => f.includes("_stage_1.ndjson"));

console.log(`\nPass 2: Finalizing ${stageFiles.length} staged files`);

let deduped = 0;

for (const stageFile of stageFiles) {
  const stagePath = resolve(dataDir, stageFile);
  const content = readFileSync(stagePath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  const ticks: { receivedAt: string; securityId: string; line: string }[] = [];
  for (const line of lines) {
    try {
      const tick = JSON.parse(line);
      ticks.push({ receivedAt: tick.received_at || "", securityId: String(tick.security_id || ""), line });
    } catch {
      // skip
    }
  }

  ticks.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

  const seen = new Set<string>();
  const uniqueLines: string[] = [];
  for (const t of ticks) {
    const dedupKey = `${t.securityId}:${t.receivedAt}`;
    if (seen.has(dedupKey)) {
      deduped++;
      continue;
    }
    seen.add(dedupKey);
    uniqueLines.push(t.line);
  }

  const finalName = stageFile.replace("_stage_1", "");
  const finalPath = resolve(dataDir, finalName);
  writeFileSync(finalPath, uniqueLines.join("\n") + "\n");
  unlinkSync(stagePath);

  console.log(`  ${finalName} — ${uniqueLines.length} ticks (${ticks.length - uniqueLines.length} dupes removed)`);
}

console.log(`\nPass 2 complete — duplicates removed: ${deduped}`);
console.log(`\nDone. Original files preserved as .bkp`);
