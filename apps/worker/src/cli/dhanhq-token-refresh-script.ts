import "../config/env.ts";
import BaseScript from "./base-script.ts";
import { nowISO } from "../utils/time.ts";

const STALE_THRESHOLD_MS = 23 * 60 * 60 * 1000;
const DHAN_API_BASE = "https://api.dhan.co/v2";

class DhanhqTokenRefreshScript extends BaseScript {
  private force = process.argv.includes("--force");
  private lastRefreshedAt: string | null = null;
  private status: "fresh" | "refreshed" | "error" = "fresh";

  get scriptName(): string {
    return "dhanhq-token-refresh";
  }

  protected getMetadata(): Record<string, unknown> {
    return { "Force": this.force, lastRefreshedAt: this.lastRefreshedAt, status: this.status };
  }

  protected async run(): Promise<void> {
    const creds = await this.firebase.getValue("dhanhq/credentials") as {
      clientId: string;
      accessToken: string;
      updatedAt: string;
    } | null;

    if (!creds?.clientId || !creds?.accessToken) {
      throw new Error("dhanhq/credentials missing or incomplete in Firebase");
    }

    const updatedAt = creds.updatedAt ? new Date(creds.updatedAt).getTime() : 0;
    const ageMs = Date.now() - updatedAt;

    if (!this.force && ageMs < STALE_THRESHOLD_MS) {
      const ageHrs = (ageMs / 3_600_000).toFixed(1);
      this.log.info(`Token is fresh (${ageHrs}h old) — no refresh needed`);
      this.status = "fresh";
      return;
    }

    this.log.info(this.force ? "Force refresh requested — refreshing via Dhan API..." : "Token is stale — refreshing via Dhan API...");

    const res = await fetch(`${DHAN_API_BASE}/RenewToken`, {
      method: "GET",
      headers: {
        "access-token": creds.accessToken,
        "dhanClientId": creds.clientId,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Dhan API error ${res.status}: ${body}`);
    }

    const data = await res.json() as { token: string; expiryTime?: string; createTime?: string };

    if (!data.token) {
      throw new Error(`Dhan API returned no token: ${JSON.stringify(data)}`);
    }

    await this.firebase.setValue("dhanhq/credentials", {
      ...creds,
      accessToken: data.token,
      updatedAt: nowISO(),
      expiryTime: data.expiryTime ?? "",
    });

    this.lastRefreshedAt = nowISO();
    this.status = "refreshed";
    this.log.info(`Token refreshed. Expires: ${data.expiryTime}`);
  }
}

new DhanhqTokenRefreshScript().start();
