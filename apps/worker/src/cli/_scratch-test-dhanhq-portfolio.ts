import "../config/env.ts";
import FirebaseClient from "../firebase/client.ts";

const DHAN_API_BASE = "https://api.dhan.co/v2";

const firebase = new FirebaseClient();
const creds = await firebase.getValue("dhanhq/credentials") as { clientId: string; accessToken: string } | null;
await firebase.destroy();

if (!creds?.clientId || !creds?.accessToken) {
  console.error("dhanhq/credentials missing in Firebase");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/json",
  "access-token": creds.accessToken,
};

console.log("\n=== HOLDINGS ===");
const holdingsRes = await fetch(`${DHAN_API_BASE}/holdings`, { headers });
console.log("Status:", holdingsRes.status);
const holdings = await holdingsRes.json();
console.log("Sample (first item):", JSON.stringify(Array.isArray(holdings) ? holdings[0] : holdings, null, 2));
console.log("Total holdings:", Array.isArray(holdings) ? holdings.length : "N/A");

console.log("\n=== POSITIONS ===");
const positionsRes = await fetch(`${DHAN_API_BASE}/positions`, { headers });
console.log("Status:", positionsRes.status);
const positions = await positionsRes.json();
console.log("Sample (first item):", JSON.stringify(Array.isArray(positions) ? positions[0] : positions, null, 2));
console.log("Total positions:", Array.isArray(positions) ? positions.length : "N/A");
