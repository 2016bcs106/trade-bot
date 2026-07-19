import "../config/env.ts";
import BaseScript from "./base-script.ts";
import NseClient from "../data/providers/nse-client.ts";

class NseHolidaysSyncScript extends BaseScript {
  private nse = new NseClient();
  private holidaysSynced = 0;

  get scriptName(): string {
    return "nse-holidays-sync";
  }

  protected getMetadata(): Record<string, unknown> {
    return { "Holidays synced": this.holidaysSynced };
  }

  protected async run(): Promise<void> {
    const holidays = await this.nse.fetchTradingHolidays();
    if (holidays.length === 0) {
      this.log.warn("NSE returned no holidays — leaving existing config/nseHolidays untouched");
      return;
    }

    await this.firebase.setValue("config/nseHolidays", holidays);
    this.holidaysSynced = holidays.length;
    this.log.info(`Synced ${holidays.length} NSE trading holidays`);
  }
}

new NseHolidaysSyncScript().start();
