const ADMIN_SECRET_KEY = 'jce_admin_secret'

export function getAdminSecret() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ADMIN_SECRET_KEY)
}
export function setAdminSecret(secret) {
  if (typeof window === 'undefined') return
  localStorage.setItem(ADMIN_SECRET_KEY, secret)
}
export function clearAdminSecret() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(ADMIN_SECRET_KEY)
}