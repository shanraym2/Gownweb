/**
 * KNN Collaborative Filtering Engine
 * ────────────────────────────────────
 * Finds K users most similar to the current user (cosine similarity on
 * interaction vectors), then aggregates their interactions to surface
 * gowns the current user hasn't interacted with yet.
 *
 * Interaction events and their weights:
 *   view        → 1
 *   favorite    → 3
 *   cart_add    → 5
 *   inquiry     → 7
 *
 * All interaction data is stored in localStorage under 'jce_interactions'.
 */

// ── Constants ──────────────────────────────────────────────────────────────

export const EVENT_WEIGHTS = {
  view: 1,
  favorite: 3,
  cart_add: 5,
  inquiry: 7,
}

const STORAGE_KEY = 'jce_interactions'
const SESSION_KEY = 'jce_session_id'
const K = 10 // number of nearest neighbors

// ── Session ID ─────────────────────────────────────────────────────────────

export function getSessionId() {
  if (typeof window === 'undefined') return 'server'
  let sid = sessionStorage.getItem(SESSION_KEY)
  if (!sid) {
    sid = `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    sessionStorage.setItem(SESSION_KEY, sid)
  }
  return sid
}

// ── Interaction Store ──────────────────────────────────────────────────────

/**
 * Shape: { [userId]: { [gownId]: weightedScore } }
 */
export function loadInteractions() {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

export function saveInteractions(data) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // localStorage may be full; evict oldest user entry
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      const keys = Object.keys(parsed)
      if (keys.length > 0) delete parsed[keys[0]]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed))
    } catch { /* silent */ }
  }
}

/**
 * Record an interaction event for a user.
 * Uses exponential decay so repeated views don't inflate scores unboundedly.
 */
export function recordInteraction(userId, gownId, eventType) {
  if (!userId || !gownId || !eventType) return
  const weight = EVENT_WEIGHTS[eventType]
  if (!weight) return

  const data = loadInteractions()
  if (!data[userId]) data[userId] = {}

  const gidKey = String(gownId)
  const current = data[userId][gidKey] || 0

  // Diminishing returns: each additional event adds less
  // Score = current + weight × (1 / (1 + 0.3 × current/weight))
  const decay = 1 / (1 + 0.3 * (current / weight))
  data[userId][gidKey] = Math.round((current + weight * decay) * 100) / 100

  saveInteractions(data)
}

// ── Vector helpers ─────────────────────────────────────────────────────────

function cosine(vecA, vecB) {
  const keysA = Object.keys(vecA)
  let dot = 0, magA = 0, magB = 0

  keysA.forEach((k) => {
    const a = vecA[k]
    const b = vecB[k] || 0
    dot += a * b
    magA += a * a
  })
  Object.values(vecB).forEach((b) => { magB += b * b })

  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

function l2Normalize(vec) {
  const mag = Math.sqrt(Object.values(vec).reduce((s, v) => s + v * v, 0))
  if (mag === 0) return vec
  const out = {}
  Object.entries(vec).forEach(([k, v]) => { out[k] = v / mag })
  return out
}

// ── KNN ────────────────────────────────────────────────────────────────────

/**
 * Given the current user's interaction vector, find the K nearest neighbors
 * from the interaction store and return their aggregated gown scores.
 *
 * @param {string} currentUserId
 * @param {Set<string>} seenIds   — gown IDs the current user has already interacted with
 * @param {number} topN
 * @returns {{ id: number, score: number, confidence: number }[]}
 */
export function getKnnScores(currentUserId, seenIds = new Set(), topN = 20) {
  const data = loadInteractions()
  const currentVec = data[currentUserId]

  // Cold start: no data for this user yet
  if (!currentVec || Object.keys(currentVec).length === 0) return []

  const normalizedCurrent = l2Normalize(currentVec)

  // Find all other users and compute similarity
  const neighbors = Object.entries(data)
    .filter(([uid]) => uid !== currentUserId)
    .map(([uid, vec]) => ({
      uid,
      vec,
      similarity: cosine(normalizedCurrent, l2Normalize(vec)),
    }))
    .filter((n) => n.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, K)

  if (neighbors.length === 0) return []

  // Weighted aggregation of neighbor scores
  const totalSimilarity = neighbors.reduce((s, n) => s + n.similarity, 0)
  const scoreMap = {}

  neighbors.forEach(({ vec, similarity }) => {
    const weight = similarity / totalSimilarity
    Object.entries(vec).forEach(([gidKey, interactionScore]) => {
      if (!seenIds.has(gidKey)) {
        scoreMap[gidKey] = (scoreMap[gidKey] || 0) + interactionScore * weight
      }
    })
  })

  const maxScore = Math.max(...Object.values(scoreMap), 1)

  return Object.entries(scoreMap)
    .map(([gidKey, score]) => ({
      id: Number(gidKey),
      score: score / maxScore,               // normalize 0–1
      confidence: neighbors.length / K,      // how reliable this estimate is
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
}

/**
 * Get the current user's interaction vector (for UI display / debugging).
 */
export function getUserVector(userId) {
  const data = loadInteractions()
  return data[userId] || {}
}

/**
 * How many other users have interaction data (for transparency).
 */
export function getInteractionUserCount() {
  return Object.keys(loadInteractions()).length
}