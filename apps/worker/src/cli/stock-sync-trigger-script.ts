import "../config/env.ts";
import BaseScript from "./base-script.ts";

class StockSyncTriggerScript extends BaseScript {
  private force = process.argv.includes("--force");

  get scriptName(): string {
    return "stock-sync-trigger";
  }

  protected getMetadata(): Record<string, unknown> {
    return { "Force": this.force };
  }

  protected async run(): Promise<void> {
    this.log.info(`Pushing stock_sync request (force=${this.force})`);

    await this.firebase.pushRequest({
      type: "stock_sync",
      payload: { force: this.force },
    });

    this.log.info("Done");
    process.exit(0);
  }
}

new StockSyncTriggerScript().start();
