import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import moment from "moment";
import { ModelMetadata } from "../types/models/model-metadata.ts";
import { TrainingResult } from "../training/models/trainable-model.ts";

/**
 * Model lifecycle management — versioning, promotion, and rollback.
 *
 * Responsibilities:
 * - Save trained model to disk (models/{symbol}/{version}/model.json)
 * - Save model metadata (models/{symbol}/{version}/metadata.json)
 * - Track production vs shadow state
 * - Promote shadow to production (if auto-optimize or manual)
 * - Rollback to previous version
 * - NEVER auto-promote when autoOptimize is disabled (locked)
 */
export default class ModelManager {
  private modelsDir: string;

  constructor(modelsDir: string = join(process.cwd(), "models")) {
    this.modelsDir = modelsDir;
  }

  /**
   * Save a training result as a new model version.
   * Returns the version string (e.g., "v1", "v2").
   */
  saveModel(result: TrainingResult): string {
    const { symbol, serializedModel, training, metrics, modelType } = result;
    const version = this.getNextVersion(symbol);

    const versionDir = join(this.modelsDir, symbol, version);
    if (!existsSync(versionDir)) {
      mkdirSync(versionDir, { recursive: true });
    }

    // Save serialized model weights
    writeFileSync(join(versionDir, "model.json"), serializedModel, "utf-8");

    // Save metadata
    const metadata: ModelMetadata = {
      symbol,
      version,
      modelType,
      state: "shadow", // New models start as shadow
      training,
      metrics,
      createdAt: moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss"),
      promotedAt: null,
      retiredAt: null,
    };

    writeFileSync(join(versionDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");

    return version;
  }

  /**
   * Promote a shadow model to production.
   * Retires the current production model.
   */
  promote(symbol: string, version: string): boolean {
    const metadata = this.loadMetadata(symbol, version);
    if (!metadata) return false;

    // Retire current production model
    const currentProd = this.getProductionVersion(symbol);
    if (currentProd) {
      this.updateState(symbol, currentProd, "retired");
    }

    // Promote new version
    this.updateState(symbol, version, "production");

    return true;
  }

  /**
   * Rollback: retire current production, promote previous version.
   */
  rollback(symbol: string): { success: boolean; rolledBackTo: string | null } {
    const versions = this.listVersions(symbol);
    const currentProd = this.getProductionVersion(symbol);

    if (!currentProd || versions.length < 2) {
      return { success: false, rolledBackTo: null };
    }

    // Find the most recent retired version
    const retired = versions
      .map((v) => this.loadMetadata(symbol, v))
      .filter((m) => m && m.state === "retired")
      .sort((a, b) => (b!.createdAt > a!.createdAt ? 1 : -1));

    if (retired.length === 0) {
      return { success: false, rolledBackTo: null };
    }

    const target = retired[0]!;
    this.updateState(symbol, currentProd, "retired");
    this.updateState(symbol, target.version, "production");

    return { success: true, rolledBackTo: target.version };
  }

  /**
   * Get the current production version for a symbol.
   */
  getProductionVersion(symbol: string): string | null {
    const versions = this.listVersions(symbol);
    for (const v of versions) {
      const metadata = this.loadMetadata(symbol, v);
      if (metadata && metadata.state === "production") {
        return v;
      }
    }
    return null;
  }

  /**
   * Get the current shadow version for a symbol.
   */
  getShadowVersion(symbol: string): string | null {
    const versions = this.listVersions(symbol);
    for (const v of versions.reverse()) {
      const metadata = this.loadMetadata(symbol, v);
      if (metadata && metadata.state === "shadow") {
        return v;
      }
    }
    return null;
  }

  /**
   * Load model metadata for a given symbol and version.
   */
  loadMetadata(symbol: string, version: string): ModelMetadata | null {
    const metadataPath = join(this.modelsDir, symbol, version, "metadata.json");
    if (!existsSync(metadataPath)) return null;

    const json = readFileSync(metadataPath, "utf-8");
    return JSON.parse(json) as ModelMetadata;
  }

  /**
   * List all versions for a symbol, sorted chronologically.
   */
  listVersions(symbol: string): string[] {
    const symbolDir = join(this.modelsDir, symbol);
    if (!existsSync(symbolDir)) return [];

    return readdirSync(symbolDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("v"))
      .map((d) => d.name)
      .sort((a, b) => {
        const numA = parseInt(a.substring(1));
        const numB = parseInt(b.substring(1));
        return numA - numB;
      });
  }

  /**
   * Get the next version number for a symbol.
   */
  private getNextVersion(symbol: string): string {
    const versions = this.listVersions(symbol);
    if (versions.length === 0) return "v1";

    const lastVersion = versions[versions.length - 1];
    const lastNum = parseInt(lastVersion.substring(1));
    return `v${lastNum + 1}`;
  }

  /**
   * Update the state of a model version.
   */
  private updateState(symbol: string, version: string, state: "production" | "shadow" | "retired"): void {
    const metadata = this.loadMetadata(symbol, version);
    if (!metadata) return;

    metadata.state = state;
    const now = moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss");

    if (state === "production") {
      metadata.promotedAt = now;
    } else if (state === "retired") {
      metadata.retiredAt = now;
    }

    const metadataPath = join(this.modelsDir, symbol, version, "metadata.json");
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
  }
}
