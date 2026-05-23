import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: resolve(__dirname, '..', '.env') })
import fetch from 'node-fetch'
import moment from 'moment'
import { initializeApp } from 'firebase/app'
import { getDatabase, ref, set, onValue } from 'firebase/database'

const app = initializeApp({
  databaseURL: process.env.FIREBASE_DATABASE_URL,
})

const db = getDatabase(app)
const requestTokenRef = ref(db, 'auth/requestToken')

console.log('🔄 Listening for requestToken changes...')

let lastProcessedToken = null

onValue(requestTokenRef, async (snapshot) => {
  const data = snapshot.val()
  if (!data || !data.token) {
    console.log('No requestToken found yet.')
    return
  }

  if (data.token === lastProcessedToken) return
  lastProcessedToken = data.token

  console.log(`📥 New requestToken: ${data.token}`)
  console.log('🔑 Exchanging for access token...')

  try {
    const response = await fetch('https://developer.paytmmoney.com/accounts/v2/gettoken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.PAYTM_MONEY_API_KEY,
        api_secret_key: process.env.PAYTM_MONEY_API_SECRET,
        request_token: data.token,
      }),
    })

    const result = await response.json()

    if (response.ok && result.access_token) {
      console.log('✅ Access token received!')
      const now = moment().utcOffset('+05:30').valueOf()

      await set(ref(db, 'auth/accessToken'), {
        token: result.access_token,
        timestamp: now,
      });

      await set(ref(db, 'auth/publicAccessToken'), {
        token: result.public_access_token,
        timestamp: now,
      })

      await set(ref(db, 'auth/readAccessToken'), {
        token: result.read_access_token,
        timestamp: now,
      })

      await set(ref(db, 'auth/updatedOn'), now)

      console.log('💾 Access tokens saved to database.')
    } else {
      console.error('❌ Token exchange failed:', result)
    }
  } catch (error) {
    console.error('❌ Error exchanging token:', error.message)
  }
})
