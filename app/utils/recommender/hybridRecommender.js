/**
 * Weighted Hybrid Recommendation Engine
 * ───────────────────────────────────────
 * Combines Content-Based Filtering, KNN Collaborative Filtering,
 * and Apriori Association Rules into a single ranked list.
 *
 * Final score = w_cbf × CBF_score + w_knn × KNN_score + w_apr × Apriori_score
 *
 * Weights are dynamic:
 *   - Cold start (no interactions)        → CBF: 1.0, KNN: 0.0, Apriori: 0.0
 *   - Some interactions (<10 users)       → CBF: 0.6, KNN: 0.2, Apriori: 0.2
 *   - Rich data (10+ users, 10+ baskets)  → CBF: 0.4, KNN: 0.35, Apriori: 0.25
 *
 * Interaction tracking is also centralised here.
 */

import { buildContentIndex, getContentScores } from './contentBased'
import {
  recordInteraction,
  getKnnScores,
  loadInteractions,
  getSessionId,
  getInteractionUserCount,
} from './knnCollaborative'
import {
  recordBasket,
  getAprioriScores,
  invalidateRulesCache,
  getAprioriStats,
  loadBaskets,
} from './apriori'

// ── Session basket tracking ────────────────────────────────────────────────

const SESSION_BASKET_KEY = 'jce_session_basket'

function getSessionBasket() {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_BASKET_KEY) || '[]')
  } catch {
    return []
  }
}

function addToSessionBasket(gownId) {
  if (typeof window === 'undefined') return
  try {
    const basket = getSessionBasket()
    const key = String(gownId)
    if (!basket.includes(key)) {
      basket.push(key)
      sessionStorage.setItem(SESSION_BASKET_KEY, JSON.stringify(basket))
    }
    // If we have at least 2 items, persist as a basket for Apriori
    if (basket.length >= 2) {
      recordBasket(basket)
      invalidateRulesCache()
    }
  } catch { /* silent */ }
}

// ── Content index cache ────────────────────────────────────────────────────

let _contentIndex = null
let _indexedGownIds = null

function getOrBuildIndex(gowns) {
  const ids = gowns.map((g) => g.id).join(',')
  if (_contentIndex && _indexedGownIds === ids) return _contentIndex
  _contentIndex = buildContentIndex(gowns)
  _indexedGownIds = ids
  return _contentIndex
}

// ── Dynamic weight computation ─────────────────────────────────────────────

export const WEIGHT_PROFILES = {
  COLD_START: { cbf: 1.0,  knn: 0.0,  apriori: 0.0,  label: 'Content-based' },
  SPARSE:     { cbf: 0.6,  knn: 0.2,  apriori: 0.2,  label: 'Hybrid (sparse data)' },
  BALANCED:   { cbf: 0.45, knn: 0.3,  apriori: 0.25, label: 'Hybrid' },
  RICH:       { cbf: 0.4,  knn: 0.35, apriori: 0.25, label: 'Hybrid (collaborative)' },
}

export function computeWeights(userId) {
  const userCount = getInteractionUserCount()
  const basketCount = loadBaskets().length
  const interactions = loadInteractions()
  const myInteractions = Object.keys(interactions[userId] || {}).length

  if (myInteractions === 0) return WEIGHT_PROFILES.COLD_START
  if (userCount < 5 || basketCount < 5) return WEIGHT_PROFILES.SPARSE
  if (userCount < 15 || basketCount < 10) return WEIGHT_PROFILES.BALANCED
  return WEIGHT_PROFILES.RICH
}

// ── Core recommendation function ───────────────────────────────────────────

/**
 * Get hybrid recommendations for a user given a context gown (detail page)
 * or their interaction history (home/catalog page).
 *
 * @param {object[]} gowns       — full gown catalog
 * @param {string}   userId      — current user ID or session ID
 * @param {object}   options
 * @param {number}   [options.contextGownId]  — gown currently being viewed
 * @param {number}   [options.topN=8]         — number of results to return
 * @param {boolean}  [options.excludeSeen]    — exclude already-seen gowns
 * @returns {{ recommendations: object[], meta: object }}
 */
export function getHybridRecommendations(gowns, userId, options = {}) {
  const { contextGownId, topN = 8, excludeSeen = true } = options

  if (!gowns || gowns.length === 0) return { recommendations: [], meta: {} }

  // ── 1. Gather seed gown IDs ──
  const interactions = loadInteractions()
  const myInteractions = interactions[userId] || {}

  // Seed IDs: context gown + user's interacted gowns, sorted by interaction score desc
  const interactionSeeds = Object.entries(myInteractions)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([id]) => id)

  const seedIds = contextGownId
    ? [String(contextGownId), ...interactionSeeds.filter((id) => id !== String(contextGownId))]
    : interactionSeeds

  // ── 2. Determine seen set ──
  const seenIds = excludeSeen
    ? new Set([...Object.keys(myInteractions), ...(contextGownId ? [String(contextGownId)] : [])])
    : new Set()

  // ── 3. Compute weights ──
  const weights = computeWeights(userId)

  // ── 4. Get scores from each algorithm ──
  const getSimilar = getOrBuildIndex(gowns)

  const cbfRaw = getContentScores(gowns, seedIds, getSimilar, 30)
  const knnRaw = getKnnScores(userId, seenIds, 30)
  const aprRaw = getAprioriScores(seedIds, seenIds, 30)

  // ── 5. Normalise each score list to [0, 1] ──
  const normalize = (list) => {
    const max = Math.max(...list.map((r) => r.score), 1)
    return list.map((r) => ({ ...r, score: r.score / max }))
  }

  const cbfScores = normalize(cbfRaw)
  const knnScores = normalize(knnRaw)
  const aprScores = normalize(aprRaw)

  // ── 6. Build combined score map ──
  const scoreMap = {}

  const apply = (list, weight, source) => {
    list.forEach(({ id, score }) => {
      const key = String(id)
      if (!scoreMap[key]) scoreMap[key] = { id: Number(id), hybrid: 0, cbf: 0, knn: 0, apriori: 0 }
      scoreMap[key].hybrid += score * weight
      scoreMap[key][source] += score * weight
    })
  }

  apply(cbfScores, weights.cbf, 'cbf')
  apply(knnScores, weights.knn, 'knn')
  apply(aprScores, weights.apriori, 'apriori')

  // ── 7. Sort and enrich with gown data ──
  const gownMap = {}
  gowns.forEach((g) => { gownMap[String(g.id)] = g })

  const ranked = Object.values(scoreMap)
    .filter((r) => gownMap[String(r.id)])
    .sort((a, b) => b.hybrid - a.hybrid)
    .slice(0, topN)
    .map((r) => ({
      ...gownMap[String(r.id)],
      _scores: {
        hybrid: Math.round(r.hybrid * 100) / 100,
        cbf:    Math.round(r.cbf    * 100) / 100,
        knn:    Math.round(r.knn    * 100) / 100,
        apriori: Math.round(r.apriori * 100) / 100,
      },
    }))

  // ── 8. Fallback: if not enough results, pad with CBF from context gown ──
  if (ranked.length < topN && contextGownId) {
    const existingIds = new Set(ranked.map((r) => String(r.id)))
    const fallback = getSimilar(contextGownId, topN * 2)
      .filter((r) => !existingIds.has(String(r.id)) && !seenIds.has(String(r.id)))
      .slice(0, topN - ranked.length)
      .map((r) => ({ ...gownMap[String(r.id)], _scores: { hybrid: r.score, cbf: r.score, knn: 0, apriori: 0 } }))
      .filter((r) => r.id !== undefined)

    ranked.push(...fallback)
  }

  const meta = {
    weights,
    seedCount: seedIds.length,
    cbfCandidates: cbfScores.length,
    knnCandidates: knnScores.length,
    aprioriCandidates: aprScores.length,
    totalUsers: getInteractionUserCount(),
    aprioriStats: getAprioriStats(),
  }

  return { recommendations: ranked, meta }
}

// ── Interaction tracking (public API) ─────────────────────────────────────

/**
 * Track a user interaction. Call this throughout the app:
 *   trackEvent(userId, gownId, 'view')
 *   trackEvent(userId, gownId, 'cart_add')
 *   trackEvent(userId, gownId, 'favorite')
 *   trackEvent(userId, gownId, 'inquiry')
 */
export function trackEvent(userId, gownId, eventType) {
  if (!userId || !gownId) return
  const uid = userId || getSessionId()
  recordInteraction(uid, gownId, eventType)
  addToSessionBasket(gownId)
}

export { getSessionId, getAprioriStats }