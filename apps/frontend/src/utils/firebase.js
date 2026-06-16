import { initializeApp } from 'firebase/app'
import { getDatabase, ref, set, get, remove, onValue, onChildAdded, off, query, orderByKey, startAt, endAt, push } from 'firebase/database'
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence } from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
const db = getDatabase(app)
const auth = getAuth(app)
setPersistence(auth, browserLocalPersistence).catch(() => {})
const googleProvider = new GoogleAuthProvider()

export { db, ref, set, get, remove, onValue, onChildAdded, off, query, orderByKey, startAt, endAt, push }
export { auth, googleProvider, signInWithPopup, onAuthStateChanged, signOut }
