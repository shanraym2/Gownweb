/**
 * Content-Based Filtering (CBF) Engine
 * ─────────────────────────────────────
 * Computes cosine similarity between gowns using a TF-IDF weighted
 * vector of their attributes: type, color, silhouette, and description tokens.
 *
 * Cold-start friendly — works with zero user interaction data.
 */

// ── Tokenizer ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','it','its','this','that','are','was','were','be','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','can','our','your','their','his','her','my','we','you',
  'they','he','she','i','very','just','so','as','from','by','about',
])

function tokenize(text) {
  if (!text || typeof text !== 'string') return []
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
}

// ── Attribute extraction ───────────────────────────────────────────────────

/**
 * Build a weighted bag-of-words for a gown.
 * Structured fields (type, color, silhouette) are boosted 3× vs description tokens.
 */
function extractTerms(gown) {
  const terms = {}

  const addField = (value, weight) => {
    if (!value) return
    tokenize(String(value)).forEach((t) => {
      terms[t] = (terms[t] || 0) + weight
    })
  }

  // Structured fields — high signal, high weight
  addField(gown.type, 3)
  addField(gown.color, 3)
  addField(gown.silhouette, 3)

  // Unstructured description — lower weight
  addField(gown.description, 1)
  addField(gown.name, 2)

  return terms
}

// ── TF-IDF ─────────────────────────────────────────────────────────────────

function buildTfIdf(gowns) {
  const rawTerms = gowns.map(extractTerms)

  // Document frequency: how many gowns contain each term
  const df = {}
  rawTerms.forEach((terms) => {
    Object.keys(terms).forEach((t) => {
      df[t] = (df[t] || 0) + 1
    })
  })

  const N = gowns.length

  // TF-IDF vectors
  return rawTerms.map((terms) => {
    const vec = {}
    const totalTermWeight = Object.values(terms).reduce((s, v) => s + v, 0) || 1

    Object.entries(terms).forEach(([t, tf]) => {
      const tfNorm = tf / totalTermWeight
      const idf = Math.log((N + 1) / ((df[t] || 0) + 1)) + 1 // smoothed IDF
      vec[t] = tfNorm * idf
    })

    return vec
  })
}

// ── Cosine similarity ──────────────────────────────────────────────────────

function cosine(vecA, vecB) {
  let dot = 0
  let magA = 0
  let magB = 0

  // Only iterate over keys in A for efficiency
  for (const [term, valA] of Object.entries(vecA)) {
    const valB = vecB[term] || 0
    dot += valA * valB
    magA += valA * valA
  }

  for (const valB of Object.values(vecB)) {
    magB += valB * valB
  }

  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a similarity index for the full catalog.
 * Returns a function: getSimilar(gownId, topN) → [{ id, score }]
 */
export function buildContentIndex(gowns) {
  if (!gowns || gowns.length === 0) return () => []

  const vectors = buildTfIdf(gowns)
  const idToIndex = {}
  gowns.forEach((g, i) => { idToIndex[String(g.id)] = i })

  return function getSimilar(gownId, topN = 10) {
    const idx = idToIndex[String(gownId)]
    if (idx === undefined) return []

    const sourceVec = vectors[idx]

    return gowns
      .map((g, i) => ({
        id: g.id,
        score: i === idx ? -1 : cosine(sourceVec, vectors[i]),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
  }
}

/**
 * Get CBF scores for a set of "seed" gown IDs (e.g. user's viewed/carted items).
 * Averages the similarity scores across all seeds.
 */
export function getContentScores(gowns, seedIds, getSimilar, topN = 20) {
  if (!seedIds || seedIds.length === 0) return []

  const scoreMap = {}

  seedIds.forEach((seedId) => {
    const similar = getSimilar(seedId, 50)
    similar.forEach(({ id, score }) => {
      const key = String(id)
      scoreMap[key] = (scoreMap[key] || 0) + score
    })
  })

  // Normalize by number of seeds
  const seedSet = new Set(seedIds.map(String))

  return Object.entries(scoreMap)
    .filter(([id]) => !seedSet.has(id))
    .map(([id, total]) => ({ id: Number(id), score: total / seedIds.length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
}
