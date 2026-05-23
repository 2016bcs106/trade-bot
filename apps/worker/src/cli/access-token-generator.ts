import "../config/env.ts";
import moment from "moment";
import createLogger from "../utils/logger.ts";
import FirebaseClient from "../firebase/client.ts";
import PaytmMoneyClient from "../data/providers/paytm-money-client.ts";

const log = createLogger("access-token-generator");
const firebase = new FirebaseClient();
const paytm = new PaytmMoneyClient();

log.info("Listening for requestToken changes...");

firebase.onRequestTokenChange(async (requestToken: string) => {
  log.info(`New requestToken received: ${requestToken}`);
  log.info("Exchanging for access token...");

  try {
    const result = await paytm.exchangeRequestToken(
      process.env.PAYTM_MONEY_API_KEY!,
      process.env.PAYTM_MONEY_API_SECRET!,
      requestToken,
    );

    if (result.access_token) {
      const updatedOn = moment().utcOffset("+05:30").valueOf();

      await firebase.saveAccessTokens({
        accessToken: result.access_token,
        publicAccessToken: result.public_access_token!,
        readAccessToken: result.read_access_token!,
        updatedOn,
      });

      log.info("Access tokens saved to database");
    } else {
      log.error("Token exchange failed", result);
    }
  } catch (error) {
    log.error("Error exchanging token", error);
  }
});
