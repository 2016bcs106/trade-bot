import "../config/env.ts";
import FirebaseClient from "../firebase/client.ts";

const firebase = new FirebaseClient();

await firebase.setValue("dhanhq/credentials", {
  clientId: "",
  accessToken: "",
  updatedAt: "",
});

console.log("Created dhanhq/credentials in Firebase.");
console.log("Fill in clientId and accessToken manually or via the next script.");

await firebase.destroy();
