/** Letters (any language), spaces, hyphen, apostrophe — no digits or other symbols */
export function isRealName(name) {
  const t = String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
  if (t.length < 2 || t.length > 80) return false
  if (/\d/.test(t)) return false
  return /^[\p{L}]+(?:[-'\s][\p{L}]+)*$/u.test(t)
}

export function getPasswordRuleChecks(password) {
  const p = String(password || '')
  return {
    length: p.length >= 8,
    letter: /[A-Za-z]/.test(p),
    number: /\d/.test(p),
  }
}

export function passwordMeetsRules(password) {
  const c = getPasswordRuleChecks(password)
  return c.length && c.letter && c.number
}
