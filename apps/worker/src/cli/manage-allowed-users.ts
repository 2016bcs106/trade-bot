import "../config/env.ts"
import FirebaseClient from "../firebase/client.ts"
import { nowISO } from "../utils/time.ts"

function emailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ',')
}

const [, , email, role = 'user'] = process.argv

if (!email) {
  console.error('Usage: tsx src/cli/manage-allowed-users.ts <email> [admin|user]')
  process.exit(1)
}

const client = new FirebaseClient()
await client.setValue(`allowedUsers/${emailKey(email)}`, {
  email: email.trim().toLowerCase(),
  role,
  addedOn: nowISO(),
})
await client.destroy()
console.log(`✓ ${email} → ${role}`)
