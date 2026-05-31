import { getDatabase, ref, remove, get } from "firebase/database";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { nowFilenameSafe } from "../utils/time.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_DIR = resolve(__dirname, "..", "..", "..", "..", "data", "backups");

const ALL_PATHS = [
  "stocks",
  "request_queue",
  "failed_requests",
  "scripts",
  "audit",
];

export class CleanupRequestHandler implements RequestHandler {
  async handle(_request: QueuedRequest, ctx: ServiceContext): Promise<void> {
    ctx.log.info("Wiping ALL Firebase data...");

    await this.snapshot(ctx);

    const db = getDatabase();
    for (const path of ALL_PATHS) {
      await remove(ref(db, path));
      ctx.log.info(`  🗑️  Cleared ${path}/`);
    }

    ctx.log.info("✓ All data cleared");
  }

  private async snapshot(ctx: ServiceContext): Promise<string> {
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
    ctx.log.info(`📸 Snapshot saved: ${filepath}`);
    return filepath;
  }
}
