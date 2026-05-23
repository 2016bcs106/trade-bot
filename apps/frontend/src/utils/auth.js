import moment from 'moment'

const AUTH_KEY = 'trade_bot_auth'

export function getAuth() {
  try {
    const data = JSON.parse(localStorage.getItem(AUTH_KEY))
    if (!data) return null

    const now = moment().utcOffset('+05:30')
    const expiry = moment(data.expiry).utcOffset('+05:30')

    if (now.isSameOrAfter(expiry)) {
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
  const now = moment().utcOffset('+05:30')
  const midnight = now.clone().endOf('day')

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
