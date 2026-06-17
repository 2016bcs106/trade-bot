import "../config/env.ts";
import FirebaseClient from "../firebase/client.ts";
import DhanhqClient from "../data/providers/dhanhq-client.ts";

const firebase = new FirebaseClient();
const creds = await firebase.getValue("dhanhq/credentials") as { clientId: string; accessToken: string } | null;
const stock = await firebase.getStock("ADANIPOWER");
await firebase.destroy();

if (!creds?.clientId || !creds?.accessToken) {
  console.error("dhanhq/credentials missing");
  process.exit(1);
}
if (!stock?.securityId) {
  console.error("ADANIPOWER not found in Firebase stocks");
  process.exit(1);
}

console.log(`ADANIPOWER securityId: ${stock.securityId}`);

const dhan = new DhanhqClient();
const result = await dhan.placeOrder(creds.accessToken, creds.clientId, {
  securityId: String(stock.securityId),
  transactionType: "BUY",
  quantity: 1,
});

console.log("Order result:", JSON.stringify(result, null, 2));
