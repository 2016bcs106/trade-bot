import "../config/env.ts";
import BaseScript from "./base-script.ts";
import { isFreshToday } from "../utils/time.ts";
import { sendPushNotification } from "../utils/web-push.ts";

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const MAX_CHECKS = 60; // ~10h cap — covers 00:15 through well past market open, avoids overlap with next day's run

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CheckAuthFreshnessScript extends BaseScript {
  private checksRun = 0;
  private notificationsSent = 0;

  get scriptName(): string {
    return "check-auth-freshness";
  }

  protected getMetadata(): Record<string, unknown> {
    return { "Checks run": this.checksRun, "Notifications sent": this.notificationsSent };
  }

  protected async run(): Promise<void> {
    for (let i = 0; i < MAX_CHECKS; i++) {
      this.checksRun++;
      const updatedOn = await this.firebase.getAuthUpdatedOn();
      if (isFreshToday(updatedOn)) {
        this.log.info("Auth token is fresh — exiting");
        return;
      }

      this.log.warn("Auth token is stale — sending login reminder");
      await sendPushNotification(this.firebase, {
        title: "Trade Bot — Login required",
        body: "Your session has expired. Open the app and log in to Paytm Money.",
        url: "/login",
      });
      this.notificationsSent++;

      if (i < MAX_CHECKS - 1) await sleep(CHECK_INTERVAL_MS);
    }
    this.log.warn("Max checks reached — exiting without a fresh token");
  }
}

new CheckAuthFreshnessScript().start();
