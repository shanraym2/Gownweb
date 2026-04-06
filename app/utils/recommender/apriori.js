/**
 * Apriori Association Rules Engine
 * ──────────────────────────────────
 * Mines frequent itemsets and association rules from user session baskets
 * (sets of gown IDs that appeared together in views/carts within a session).
 *
 * Produces rules of the form:
 *   {antecedent} → {consequent}  [support, confidence, lift]
 *
 * Storage key: 'jce_baskets'
 * Shape: Array<Set<string>> serialised as Array<Array<string>>
 */

const BASKET_KEY = 'jce_baskets'
const MAX_BASKETS = 500     // rolling window to cap localStorage usage
const MIN_SUPPORT = 0.02    // 2% of baskets must contain the itemset
const MIN_CONFIDENCE = 0.3  // 30% confidence threshold for rules
const MAX_ITEMSET_SIZE = 3  // keep Apriori tractable

// ── Basket store ───────────────────────────────────────────────────────────

export function loadBaskets() {
  if (typeof window === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(BASKET_KEY) || '[]')
    return raw.map((b) => new Set(b))
  } catch {
    return []
  }
}

export function saveBaskets(baskets) {
  if (typeof window === 'undefined') return
  // Keep the most recent MAX_BASKETS
  const trimmed = baskets.slice(-MAX_BASKETS)
  try {
    localStorage.setItem(BASKET_KEY, JSON.stringify(trimmed.map((b) => [...b])))
  } catch {
    // Storage full — drop oldest half
    try {
      const half = trimmed.slice(Math.floor(trimmed.length / 2))
      localStorage.setItem(BASKET_KEY, JSON.stringify(half.map((b) => [...b])))
    } catch { /* silent */ }
  }
}

/**
 * Add a basket (the set of gown IDs touched in the current session).
 * Call this when a session ends or when the user navigates away.
 */
export function recordBasket(gownIds) {
  if (!gownIds || gownIds.length < 2) return  // need at least a pair
  const baskets = loadBaskets()
  baskets.push(new Set(gownIds.map(String)))
  saveBaskets(baskets)
}

// ── Apriori helpers ────────────────────────────────────────────────────────

function support(itemset, baskets) {
  const items = [...itemset]
  const count = baskets.filter((b) => items.every((i) => b.has(i))).length
  return count / baskets.length
}

function generateCandidates(frequentSets, size) {
  const candidates = []
  const list = [...frequentSets]

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const union = new Set([...list[i], ...list[j]])
      if (union.size === size) {
        // Check if already added (dedup by sorted key)
        const key = [...union].sort().join('|')
        if (!candidates.some((c) => [...c].sort().join('|') === key)) {
          candidates.push(union)
        }
      }
    }
  }

  return candidates
}

// ── Apriori algorithm ──────────────────────────────────────────────────────

/**
 * Run the Apriori algorithm and return all frequent itemsets.
 * @returns {Map<string, number>} key → serialised sorted itemset, value → support
 */
function apriori(baskets, minSupport) {
  if (baskets.length === 0) return new Map()

  // Get all unique items
  const allItems = new Set()
  baskets.forEach((b) => b.forEach((i) => allItems.add(i)))

  const frequentMap = new Map() // key: sorted items joined by '|', value: support
  let currentLevel = [...allItems].map((i) => new Set([i]))

  for (let size = 1; size <= MAX_ITEMSET_SIZE; size++) {
    const nextLevel = []

    for (const candidate of currentLevel) {
      const sup = support(candidate, baskets)
      if (sup >= minSupport) {
        const key = [...candidate].sort().join('|')
        frequentMap.set(key, sup)
        nextLevel.push(candidate)
      }
    }

    if (nextLevel.length === 0) break
    currentLevel = generateCandidates(nextLevel, size + 1)
  }

  return frequentMap
}

// ── Rule generation ────────────────────────────────────────────────────────

/**
 * Generate association rules from frequent itemsets.
 * Rule: antecedent → consequent
 *   confidence = support(antecedent ∪ consequent) / support(antecedent)
 *   lift       = confidence / support(consequent)
 */
function generateRules(frequentMap, minConfidence) {
  const rules = []

  for (const [itemsetKey, itemsetSupport] of frequentMap) {
    const items = itemsetKey.split('|')
    if (items.length < 2) continue

    // Generate all non-empty proper subsets as antecedents
    const subsets = getProperSubsets(items)

    for (const antecedent of subsets) {
      const consequentItems = items.filter((i) => !antecedent.includes(i))
      if (consequentItems.length === 0) continue

      const antecedentKey = [...antecedent].sort().join('|')
      const consequentKey = [...consequentItems].sort().join('|')

      const antecedentSupport = frequentMap.get(antecedentKey)
      const consequentSupport = frequentMap.get(consequentKey)

      if (!antecedentSupport || !consequentSupport) continue

      const confidence = itemsetSupport / antecedentSupport
      if (confidence < minConfidence) continue

      const lift = confidence / consequentSupport

      rules.push({
        antecedent,
        consequent: consequentItems,
        support: itemsetSupport,
        confidence,
        lift,
      })
    }
  }

  // Sort by lift descending (higher lift = stronger association)
  return rules.sort((a, b) => b.lift - a.lift)
}

function getProperSubsets(items) {
  const subsets = []
  const n = items.length
  for (let mask = 1; mask < (1 << n) - 1; mask++) {
    const subset = items.filter((_, i) => mask & (1 << i))
    subsets.push(subset)
  }
  return subsets
}

// ── Public API ─────────────────────────────────────────────────────────────

let _rulesCache = null
let _rulesCacheTime = 0
const CACHE_TTL = 60_000 // 1 minute

/**
 * Get association rules, cached for 1 minute to avoid re-running Apriori on
 * every recommendation request.
 */
export function getRules(minSupport = MIN_SUPPORT, minConfidence = MIN_CONFIDENCE) {
  const now = Date.now()
  if (_rulesCache && now - _rulesCacheTime < CACHE_TTL) return _rulesCache

  const baskets = loadBaskets()
  if (baskets.length < 5) {
    _rulesCache = []
    _rulesCacheTime = now
    return []
  }

  const frequentMap = apriori(baskets, minSupport)
  _rulesCache = generateRules(frequentMap, minConfidence)
  _rulesCacheTime = now
  return _rulesCache
}

/**
 * Given a set of seed gown IDs the user has interacted with,
 * return Apriori-based scores for candidate gowns.
 *
 * Score = Σ (confidence × lift) for all rules where
 *         antecedent ⊆ seedIds and consequent = candidateId
 */
export function getAprioriScores(seedIds, seenIds = new Set(), topN = 20) {
  if (!seedIds || seedIds.length === 0) return []

  const rules = getRules()
  if (rules.length === 0) return []

  const seedSet = new Set(seedIds.map(String))
  const scoreMap = {}

  rules.forEach(({ antecedent, consequent, confidence, lift }) => {
    // Check if antecedent is a subset of seeds
    const antecedentMatches = antecedent.every((i) => seedSet.has(i))
    if (!antecedentMatches) return

    consequent.forEach((gidKey) => {
      if (!seenIds.has(gidKey) && !seedSet.has(gidKey)) {
        scoreMap[gidKey] = (scoreMap[gidKey] || 0) + confidence * Math.min(lift, 5)
      }
    })
  })

  const maxScore = Math.max(...Object.values(scoreMap), 1)

  return Object.entries(scoreMap)
    .map(([gidKey, score]) => ({
      id: Number(gidKey),
      score: score / maxScore,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
}

/**
 * Returns stats for transparency UI.
 */
export function getAprioriStats() {
  const baskets = loadBaskets()
  const rules = getRules()
  return {
    basketCount: baskets.length,
    ruleCount: rules.length,
    topRules: rules.slice(0, 5).map((r) => ({
      if: r.antecedent.join(', '),
      then: r.consequent.join(', '),
      confidence: Math.round(r.confidence * 100),
      lift: Math.round(r.lift * 100) / 100,
    })),
  }
}

/**
 * Invalidate the rules cache (call after recording a new basket).
 */
export function invalidateRulesCache() {
  _rulesCache = null
  _rulesCacheTime = 0
}
