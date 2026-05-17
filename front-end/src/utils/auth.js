const AUTH_KEY = 'trade_bot_auth'

export function getAuth() {
  try {
    const data = JSON.parse(localStorage.getItem(AUTH_KEY))
    if (!data) return null

    const now = new Date()
    const expiry = new Date(data.expiry)

    if (now >= expiry) {
      localStorage.removeItem(AUTH_KEY)
      return null
    }

    return data
  } catch {
    localStorage.removeItem(AUTH_KEY)
    return null
  }
}

export function setAuth(requestToken) {
  const now = new Date()
  const midnight = new Date(now)
  midnight.setHours(23, 59, 59, 999)

  const data = {
    requestToken,
    expiry: midnight.toISOString(),
  }

  localStorage.setItem(AUTH_KEY, JSON.stringify(data))
  return data
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY)
}

export function isAuthenticated() {
  return getAuth() !== null
}
