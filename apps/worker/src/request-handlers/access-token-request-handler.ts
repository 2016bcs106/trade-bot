import { nowMs } from "../utils/time.ts";
import createLogger from "../utils/logger.ts";
import { QueuedRequest } from "../firebase/client.ts";
import { RequestHandler, ServiceContext } from "./request-handler.ts";

const logger = createLogger("handler:access-token");

/**
 * Handles "access_token" requests — exchanges a Paytm Money requestToken
 * for access/public/read tokens and saves them to Firebase.
 *
 * Expected payload:
 * - requestToken: string (OAuth request_token from Paytm Money callback)
 */
export class AccessTokenRequestHandler implements RequestHandler {
  async handle(request: QueuedRequest, ctx: ServiceContext): Promise<void> {
    const { requestToken } = request.payload as { requestToken: string };

    if (!requestToken) {
      throw new Error("access_token requires payload: { requestToken }");
    }

    const apiKey = process.env.PAYTM_MONEY_API_KEY;
    const apiSecret = process.env.PAYTM_MONEY_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new Error("Missing PAYTM_MONEY_API_KEY or PAYTM_MONEY_API_SECRET in .env");
    }

    logger.info("Exchanging requestToken for access tokens...");

    const result = await ctx.paytm.exchangeRequestToken(apiKey, apiSecret, requestToken);

    if (!result.access_token) {
      throw new Error(`Token exchange failed: ${JSON.stringify(result)}`);
    }

    const updatedOn = nowMs();

    await ctx.firebase.saveAccessTokens({
      accessToken: result.access_token,
      publicAccessToken: result.public_access_token!,
      readAccessToken: result.read_access_token!,
      updatedOn,
    });

    logger.info("✓ Access tokens saved to Firebase");
  }
}
