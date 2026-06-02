import "../config/env.ts";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { readdirSync, readFileSync } from "fs";
import { gzipSync } from "zlib";
// @ts-ignore — installed on server
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import moment from "moment";
import BaseScript from "./base-script.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const R2_ENDPOINT = process.env.R2_ENDPOINT!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET = process.env.R2_BUCKET!;
const RETENTION_DAYS = 30;

class TickArchiverScript extends BaseScript {
  private dataDir = resolve(__dirname, "..", "..", "..", "..", "data");
  private s3: S3Client;
  private uploadedCount = 0;
  private deletedCount = 0;

  constructor() {
    super();
    this.s3 = new S3Client({
      region: "auto",
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }

  get scriptName(): string {
    return "tick-archiver";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      uploadedCount: this.uploadedCount,
      deletedCount: this.deletedCount,
    };
  }

  protected async run(): Promise<void> {
    this.log.info("Starting tick data archival");

    const today = moment().utcOffset("+05:30").format("YYYY-MM-DD");
    await this.uploadDayFiles(today);
    await this.deleteOldFiles();

    this.log.info(`Archival complete — uploaded=${this.uploadedCount} deleted=${this.deletedCount}`);
  }

  private async uploadDayFiles(date: string): Promise<void> {
    const files = readdirSync(this.dataDir).filter(
      (f) => f.endsWith(".ndjson") && f.includes(date)
    );

    if (files.length === 0) {
      this.log.info(`No files found for ${date}`);
      return;
    }

    this.log.info(`Found ${files.length} files for ${date}`);

    for (const fileName of files) {
      const filePath = resolve(this.dataDir, fileName);
      const content = readFileSync(filePath);
      const compressed = gzipSync(content, { level: 9 });
      const ratio = ((1 - compressed.length / content.length) * 100).toFixed(1);

      const key = `${date}/${fileName}.gz`;

      await this.s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: compressed,
        ContentType: "application/gzip",
      }));

      this.uploadedCount++;
      this.log.info(`Uploaded ${key} (${(content.length / 1024).toFixed(0)}KB → ${(compressed.length / 1024).toFixed(0)}KB, ${ratio}% compression)`);
    }
  }

  private async deleteOldFiles(): Promise<void> {
    const cutoffDate = moment().utcOffset("+05:30").subtract(RETENTION_DAYS, "days").format("YYYY-MM-DD");

    const listed = await this.s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
    }));

    if (!listed.Contents || listed.Contents.length === 0) return;

    const toDelete = listed.Contents.filter((obj: { Key?: string }) => {
      const datePrefix = obj.Key?.split("/")[0];
      if (!datePrefix || !/^\d{4}-\d{2}-\d{2}$/.test(datePrefix)) return false;
      return datePrefix < cutoffDate;
    });

    if (toDelete.length === 0) {
      this.log.info("No files older than 30 days to delete");
      return;
    }

    const batchSize = 1000;
    for (let i = 0; i < toDelete.length; i += batchSize) {
      const batch = toDelete.slice(i, i + batchSize);
      await this.s3.send(new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: batch.map((obj: { Key?: string }) => ({ Key: obj.Key })) },
      }));
      this.deletedCount += batch.length;
    }

    this.log.info(`Deleted ${this.deletedCount} files older than ${cutoffDate}`);
  }
}

new TickArchiverScript().start();
