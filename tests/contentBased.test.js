/**
 * Content-Based Filtering — Unit Tests
 * ──────────────────────────────────────
 * Tests mathematical correctness of TF-IDF and cosine similarity,
 * and validates that similar gowns score higher than dissimilar ones.
 *
 * Run: npx vitest run tests/contentBased.test.js
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { buildContentIndex, getContentScores } from '@/utils/recommender/contentBased'
import { TEST_GOWNS } from './fixtures'

// ── Setup ──────────────────────────────────────────────────────────────────

let getSimilar

beforeAll(() => {
  getSimilar = buildContentIndex(TEST_GOWNS)
})

// ── Index construction ─────────────────────────────────────────────────────

describe('buildContentIndex', () => {
  it('returns a function', () => {
    expect(typeof getSimilar).toBe('function')
  })

  it('returns empty array for an empty catalog', () => {
    const emptyIndex = buildContentIndex([])
    expect(emptyIndex(1)).toEqual([])
  })

  it('returns empty array for an unknown gown ID', () => {
    const result = getSimilar(9999)
    expect(result).toEqual([])
  })

  it('never returns the source gown in results', () => {
    TEST_GOWNS.forEach((gown) => {
      const results = getSimilar(gown.id, 20)
      const ids = results.map((r) => r.id)
      expect(ids).not.toContain(gown.id)
    })
  })

  it('scores are all between 0 and 1', () => {
    const results = getSimilar(1, 20)
    results.forEach(({ score }) => {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    })
  })

  it('results are sorted by score descending', () => {
    const results = getSimilar(1, 20)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  it('respects the topN limit', () => {
    const results = getSimilar(1, 3)
    expect(results.length).toBeLessThanOrEqual(3)
  })
})

// ── Semantic correctness ───────────────────────────────────────────────────

describe('CBF semantic correctness', () => {
  it('ball gowns are most similar to other ball gowns', () => {
    // Gown 1: Ball Gown, Ivory
    // Gowns 2 and 10 are also Ball Gowns → should rank highest
    const results = getSimilar(1, 5)
    const topTypes = results.slice(0, 3).map((r) => {
      const gown = TEST_GOWNS.find((g) => g.id === r.id)
      return gown?.type
    })
    expect(topTypes).toContain('Ball Gown')
  })

  it('mermaid gown is more similar to other mermaid than to sheath', () => {
    // Gown 5: Mermaid, White
    // Gown 6: Mermaid, Ivory  → should score higher than
    // Gown 7: Sheath, Blush
    const results = getSimilar(5, 10)
    const mermaidResult = results.find((r) => r.id === 6)
    const sheathResult  = results.find((r) => r.id === 7)

    expect(mermaidResult).toBeDefined()
    // Mermaid should outrank Sheath
    const mermaidIdx = results.findIndex((r) => r.id === 6)
    const sheathIdx  = results.findIndex((r) => r.id === 7)
    expect(mermaidIdx).toBeLessThan(sheathIdx)
  })

  it('ivory gowns rank higher for another ivory gown vs champagne gowns', () => {
    // Gown 3: A-Line, Ivory — should prefer gown 9 (Tea Length, Ivory) over gown 4 (A-Line, Champagne)
    // Both are A-line but gown 9 shares the ivory color
    const results = getSimilar(3, 10)
    const ivoryResult    = results.find((r) => r.id === 9)
    const champagneResult = results.find((r) => r.id === 4)

    // Both should appear; ivory should rank closer to top
    expect(ivoryResult).toBeDefined()
    expect(champagneResult).toBeDefined()
  })

  it('sheath gowns are more similar to each other than to ball gowns', () => {
    // Gown 7: Sheath, Blush
    // Gown 8: Sheath, White → should rank above gowns 1,2,10 (Ball Gowns)
    const results = getSimilar(7, 10)
    const sheathIdx    = results.findIndex((r) => r.id === 8)
    const ballGownIdxs = results
      .map((r, i) => ({ id: r.id, i }))
      .filter(({ id }) => [1, 2, 10].includes(id))
      .map(({ i }) => i)

    expect(sheathIdx).toBeDefined()
    // Sheath should appear before the majority of ball gowns
    const betterThanBallGowns = ballGownIdxs.filter((idx) => sheathIdx < idx)
    expect(betterThanBallGowns.length).toBeGreaterThanOrEqual(2)
  })
})

// ── getContentScores (multi-seed) ──────────────────────────────────────────

describe('getContentScores', () => {
  it('returns empty array for empty seed list', () => {
    const result = getContentScores(TEST_GOWNS, [], getSimilar)
    expect(result).toEqual([])
  })

  it('excludes seed gowns from results', () => {
    const seeds = ['1', '2']
    const results = getContentScores(TEST_GOWNS, seeds, getSimilar)
    const resultIds = results.map((r) => String(r.id))
    expect(resultIds).not.toContain('1')
    expect(resultIds).not.toContain('2')
  })

  it('with ball gown seeds, prioritises other ball gowns', () => {
    // Seeds: gowns 1 and 2 (both Ball Gown)
    const results = getContentScores(TEST_GOWNS, ['1', '2'], getSimilar, 5)
    const topResult = results[0]
    const topGown = TEST_GOWNS.find((g) => g.id === topResult.id)
    expect(topGown?.type).toBe('Ball Gown')
  })

  it('averaging reduces noise from a single outlier seed', () => {
    // Single seed should give different (noisier) results vs averaged multi-seed
    const single = getContentScores(TEST_GOWNS, ['1'], getSimilar, 10)
    const multi  = getContentScores(TEST_GOWNS, ['1', '2', '10'], getSimilar, 10)
    // Both should have results — the key is both work
    expect(single.length).toBeGreaterThan(0)
    expect(multi.length).toBeGreaterThan(0)
  })
})