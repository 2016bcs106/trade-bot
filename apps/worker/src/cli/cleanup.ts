import "../config/env.ts";
import "../firebase/client.ts"; // side-effect: initializes Firebase app
import { getDatabase, ref, remove, get, set } from "firebase/database";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import ModelManager from "../model-management/model-manager.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = resolve(__dirname, "..", "..", "..", "..", "data", "backups");
const modelManager = new ModelManager();

/**
 * Firebase cleanup utility with snapshot backup/restore.
 *
 * Before any deletion, saves a timestamped JSON snapshot to data/backups/
 * so you can restore if needed.
 *
 * Usage:
 *   pnpm cleanup              — show summary of what exists in Firebase
 *   pnpm cleanup --all        — snapshot + wipe everything
 *   pnpm cleanup --pending    — snapshot + clear pending_trainings + pending_predictions
 *   pnpm cleanup --models     — snapshot + clear models
 *   pnpm cleanup --predictions — snapshot + clear predictions
 *   pnpm cleanup --stocks     — snapshot + clear stocks + models + predictions + pending
 *   pnpm cleanup --scripts    — snapshot + clear script status
 *   pnpm cleanup --audit      — snapshot + clear audit events
 *   pnpm cleanup --restore <file> — restore from a backup snapshot
 */

const ALL_PATHS = [
  "stocks",
  "models",
  "predictions",
  "pending_trainings",
  "pending_predictions",
  "scripts",
  "audit",
];

/** Save snapshot of specified paths to disk before deletion */
async function snapshot(paths: string[]): Promise<string> {
  const db = getDatabase();
  const data: Record<string, unknown> = {};

  for (const path of paths) {
    const snap = await get(ref(db, path));
    const val = snap.val();
    if (val) data[path] = val;
  }

  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `backup-${ts}.json`;
  const filepath = resolve(BACKUP_DIR, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`📸 Snapshot saved: ${filepath}`);
  return filepath;
}

/** Restore data from a backup file */
async function restore(filepath: string): Promise<void> {
  const db = getDatabase();
  const absPath = resolve(filepath);

  if (!existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(absPath, "utf-8"));
  const paths = Object.keys(data);

  console.log(`🔄 Restoring ${paths.length} paths from ${absPath}...`);
  for (const path of paths) {
    await set(ref(db, path), data[path]);
    const count = typeof data[path] === "object" ? Object.keys(data[path]).length : 1;
    console.log(`  ✓ Restored ${path}/ (${count} entries)`);
  }
  console.log("Done.");
}

async function clearPaths(paths: string[]): Promise<void> {
  await snapshot(paths);
  const db = getDatabase();
  for (const path of paths) {
    await remove(ref(db, path));
    console.log(`  🗑️  Cleared ${path}/`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Restore mode
  if (args.includes("--restore")) {
    const idx = args.indexOf("--restore");
    const file = args[idx + 1];
    if (!file) {
      console.error("Usage: pnpm cleanup --restore <path-to-backup.json>");
      process.exit(1);
    }
    await restore(file);
    process.exit(0);
  }

  if (args.includes("--all")) {
    console.log("🗑️  Wiping ALL Firebase data...");
    await clearPaths(ALL_PATHS);
    // Also delete local model files (backups are NOT touched)
    const localSymbols = modelManager.listSymbols();
    if (localSymbols.length > 0) {
      modelManager.deleteAllLocal();
      console.log(`  🗑️  Deleted local models for ${localSymbols.length} symbols`);
    }
    console.log("✓ All data cleared.");
    process.exit(0);
  }

  if (args.includes("--pending")) {
    await clearPaths(["pending_trainings", "pending_predictions"]);
    console.log("✓ Cleared pending queues.");
    process.exit(0);
  }

  if (args.includes("--models")) {
    await clearPaths(["models"]);
    // Also delete local model files
    const localSymbols = modelManager.listSymbols();
    if (localSymbols.length > 0) {
      modelManager.deleteAllLocal();
      console.log(`  🗑️  Deleted local models for ${localSymbols.length} symbols`);
    }
    console.log("✓ Cleared models (Firebase + local).");
    process.exit(0);
  }

  if (args.includes("--predictions")) {
    await clearPaths(["predictions"]);
    console.log("✓ Cleared predictions.");
    process.exit(0);
  }

  if (args.includes("--stocks")) {
    await clearPaths(["stocks", "models", "predictions", "pending_trainings", "pending_predictions"]);
    // Also delete local model files
    const localSymbols = modelManager.listSymbols();
    if (localSymbols.length > 0) {
      modelManager.deleteAllLocal();
      console.log(`  🗑️  Deleted local models for ${localSymbols.length} symbols`);
    }
    console.log("✓ Cleared stocks + related data (Firebase + local).");
    process.exit(0);
  }

  if (args.includes("--scripts")) {
    await clearPaths(["scripts"]);
    console.log("✓ Cleared script status.");
    process.exit(0);
  }

  if (args.includes("--audit")) {
    await clearPaths(["audit"]);
    console.log("✓ Cleared audit events.");
    process.exit(0);
  }

  // Per-symbol cleanup: --symbol SYMBOL (deletes local models + Firebase model/prediction data for that symbol)
  if (args.includes("--symbol")) {
    const idx = args.indexOf("--symbol");
    const symbol = args[idx + 1]?.toUpperCase();
    if (!symbol) {
      console.error("Usage: pnpm cleanup --symbol RELIANCE");
      process.exit(1);
    }
    const db = getDatabase();
    // Snapshot before deletion
    await snapshot([`models/${symbol}`, `predictions/${symbol}`, `stocks/${symbol}`]);
    // Firebase cleanup
    await remove(ref(db, `models/${symbol}`));
    await remove(ref(db, `predictions/${symbol}`));
    await remove(ref(db, `stocks/${symbol}`));
    console.log(`  🗑️  Cleared Firebase: stocks/${symbol}, models/${symbol}, predictions/${symbol}`);
    // Local cleanup
    modelManager.deleteSymbolLocal(symbol);
    console.log(`  🗑️  Deleted local models for ${symbol}`);
    console.log(`✓ Cleaned up ${symbol} (Firebase + local).`);
    process.exit(0);
  }

  // Default: show summary
  const db = getDatabase();
  console.log("\n📊 Firebase data summary:\n");
  for (const path of ALL_PATHS) {
    const snap = await get(ref(db, path));
    const data = snap.val();
    const count = data ? Object.keys(data).length : 0;
    const status = count > 0 ? `${count} entries` : "(empty)";
    console.log(`  ${path.padEnd(22)} ${status}`);
  }

  console.log("\nCommands:");
  console.log("  pnpm cleanup --all            Snapshot + wipe everything");
  console.log("  pnpm cleanup --pending        Snapshot + clear pending queues");
  console.log("  pnpm cleanup --models         Snapshot + clear models");
  console.log("  pnpm cleanup --predictions    Snapshot + clear predictions");
  console.log("  pnpm cleanup --stocks         Snapshot + clear stocks + models + predictions + pending");
  console.log("  pnpm cleanup --scripts        Snapshot + clear script status");
  console.log("  pnpm cleanup --audit          Snapshot + clear audit events");
  console.log("  pnpm cleanup --restore <file> Restore from backup snapshot");
  console.log(`\nBackups saved to: ${BACKUP_DIR}`);
  console.log("");
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
