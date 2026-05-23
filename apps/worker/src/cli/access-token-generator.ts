import "../config/env.ts";
import moment from "moment";
import BaseScript from "./base-script.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";

class AccessTokenGeneratorScript extends BaseScript {
  private paytm = new PaytmMoneyClient();
  private tokensExchanged = 0;
  private lastExchangeAt: string | null = null;

  get scriptName(): string {
    return "access-token-generator";
  }

  protected getMetadata(): Record<string, unknown> {
    return {
      tokensExchanged: this.tokensExchanged,
      lastExchangeAt: this.lastExchangeAt,
    };
  }

  protected async run(): Promise<void> {
    this.log.info("Listening for requestToken changes...");

    this.firebase.onRequestTokenChange(async (requestToken: string) => {
      this.log.info(`New requestToken received: ${requestToken}`);
      this.log.info("Exchanging for access token...");

      try {
        const result = await this.paytm.exchangeRequestToken(
          process.env.PAYTM_MONEY_API_KEY!,
          process.env.PAYTM_MONEY_API_SECRET!,
          requestToken,
        );

        if (result.access_token) {
          const updatedOn = moment().utcOffset("+05:30").valueOf();

          await this.firebase.saveAccessTokens({
            accessToken: result.access_token,
            publicAccessToken: result.public_access_token!,
            readAccessToken: result.read_access_token!,
            updatedOn,
          });

          this.tokensExchanged++;
          this.lastExchangeAt = moment().utcOffset("+05:30").format("YYYY-MM-DD HH:mm:ss");
          this.log.info("Access tokens saved to database");
        } else {
          this.log.error("Token exchange failed", result);
        }
      } catch (error) {
        this.log.error("Error exchanging token", error);
      }
    });

    // Keep process alive
    await new Promise(() => {});
  }
}

new AccessTokenGeneratorScript().start();
