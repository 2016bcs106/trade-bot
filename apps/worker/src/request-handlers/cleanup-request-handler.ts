import { getDatabase, ref, remove, get } from "firebase/database";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { nowFilenameSafe } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";

const logger = createLogger("handler:cleanup");

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = resolve(__dirname, "..", "..", "..", "..", "data", "backups");

const ALL_PATHS = [
  "stocks",
  "request_queue",
  "failed_requests",
  "scripts",
  "audit",
];

/**
 * Handles "cleanup" requests — wipes ALL Firebase data + local models.
 * Takes a JSON snapshot backup before deletion.
 *
 * No payload required.
 */
export class CleanupRequestHandler implements RequestHandler {
  async handle(_request: QueuedRequest, _ctx: ServiceContext): Promise<void> {
    logger.info("Wiping ALL Firebase data...");

    // Snapshot before deletion
    await this.snapshot();

    // Clear all Firebase paths
    const db = getDatabase();
    for (const path of ALL_PATHS) {
      await remove(ref(db, path));
      logger.info(`  🗑️  Cleared ${path}/`);
    }

    logger.info("✓ All data cleared");
  }

  private async snapshot(): Promise<string> {
    const db = getDatabase();
    const data: Record<string, unknown> = {};

    for (const path of ALL_PATHS) {
      const snap = await get(ref(db, path));
      const val = snap.val();
      if (val) data[path] = val;
    }

    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const ts = nowFilenameSafe();
    const filename = `backup-${ts}.json`;
    const filepath = resolve(BACKUP_DIR, filename);
    writeFileSync(filepath, JSON.stringify(data, null, 2));
    logger.info(`📸 Snapshot saved: ${filepath}`);
    return filepath;
  }
}
