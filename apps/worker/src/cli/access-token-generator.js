import "../config/env.js";
import moment from "moment";
import FirebaseClient from "../firebase/client.js";
import PaytmMoneyClient from "../data/providers/paytm-money-client.js";

const firebase = new FirebaseClient();
const paytm = new PaytmMoneyClient();

console.log("🔄 Listening for requestToken changes...");

firebase.onRequestTokenChange(async (requestToken) => {
  console.log(`📥 New requestToken: ${requestToken}`);
  console.log("🔑 Exchanging for access token...");

  try {
    const result = await paytm.exchangeRequestToken(
      process.env.PAYTM_MONEY_API_KEY,
      process.env.PAYTM_MONEY_API_SECRET,
      requestToken,
    );

    if (result.access_token) {
      console.log("✅ Access token received!");
      const updatedOn = moment().utcOffset("+05:30").valueOf();

      await firebase.saveAccessTokens({
        accessToken: result.access_token,
        publicAccessToken: result.public_access_token,
        readAccessToken: result.read_access_token,
        updatedOn,
      });

      console.log("💾 Access tokens saved to database.");
    } else {
      console.error("❌ Token exchange failed:", result);
    }
  } catch (error) {
    console.error("❌ Error exchanging token:", error.message);
  }
});
