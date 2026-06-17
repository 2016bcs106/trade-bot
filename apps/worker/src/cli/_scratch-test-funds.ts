import "../config/env.ts";
import FirebaseClient from "../firebase/client.ts";

const firebase = new FirebaseClient();
const paytmToken = await firebase.getAccessToken();
const dhanCreds = await firebase.getValue("dhanhq/credentials") as { clientId: string; accessToken: string } | null;
await firebase.destroy();

// ─── Dhan fundlimit ───────────────────────────────────────────────────────────
console.log("\n=== DHAN /fundlimit ===");
const dhanRes = await fetch("https://api.dhan.co/v2/fundlimit", {
  headers: {
    "Content-Type": "application/json",
    "access-token": dhanCreds!.accessToken,
    "dhanClientId": dhanCreds!.clientId,
  },
});
console.log("Status:", dhanRes.status);
console.log(JSON.stringify(await dhanRes.json(), null, 2));

// ─── Paytm Money — try known fund endpoints ───────────────────────────────────
const paytmHeaders = { "x-jwt-token": paytmToken };

console.log("\n=== PAYTM /accounts/v1/funds/summary ===");
const paytmFundsRes = await fetch("https://developer.paytmmoney.com/accounts/v1/funds/summary?config=true", {
  headers: paytmHeaders,
});
console.log("Status:", paytmFundsRes.status);
console.log(JSON.stringify(await paytmFundsRes.json(), null, 2));
