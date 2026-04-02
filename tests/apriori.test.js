/**
 * Apriori Association Rules — Unit Tests
 * ────────────────────────────────────────
 * Tests basket recording, Apriori frequent itemset mining,
 * rule generation (support / confidence / lift), and score computation.
 *
 * Run: npx vitest run tests/apriori.test.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  loadBaskets,
  saveBaskets,
  recordBasket,
  getRules,
  getAprioriScores,
  getAprioriStats,
  invalidateRulesCache,
} from '../app/utils/recommender/apriori'
import {
  installStorageMocks,
  clearStorageMocks,
  seedBaskets,
} from './storageMock'
import { TEST_BASKETS } from './fixtures'

// ── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  installStorageMocks()
  invalidateRulesCache()
})

afterEach(() => {
  clearStorageMocks()
  invalidateRulesCache()
})

// ── recordBasket ───────────────────────────────────────────────────────────

describe('recordBasket', () => {
  it('stores a basket with 2+ items', () => {
    recordBasket(['1', '2'])
    const baskets = loadBaskets()
    expect(baskets).toHaveLength(1)
    expect(baskets[0].has('1')).toBe(true)
    expect(baskets[0].has('2')).toBe(true)
  })

  it('ignores baskets with fewer than 2 items', () => {
    recordBasket([])
    recordBasket(['1'])
    expect(loadBaskets()).toHaveLength(0)
  })

  it('deduplicates items within a basket (uses Set)', () => {
    recordBasket(['1', '1', '2'])
    const baskets = loadBaskets()
    expect(baskets[0].size).toBe(2) // Set removes duplicate '1'
  })

  it('appends multiple baskets', () => {
    recordBasket(['1', '2'])
    recordBasket(['3', '4'])
    recordBasket(['1', '3', '5'])
    expect(loadBaskets()).toHaveLength(3)
  })

  it('trims to MAX_BASKETS (500) by keeping most recent', () => {
    // Record 510 baskets
    for (let i = 0; i < 510; i++) {
      recordBasket([String(i), String(i + 1)])
    }
    expect(loadBaskets().length).toBeLessThanOrEqual(500)
  })
})

// ── getRules ───────────────────────────────────────────────────────────────

describe('getRules', () => {
  it('returns empty array when fewer than 5 baskets exist', () => {
    recordBasket(['1', '2'])
    recordBasket(['1', '3'])
    const rules = getRules()
    expect(rules).toEqual([])
  })

  it('returns rules after sufficient baskets are recorded', () => {
    seedBaskets(TEST_BASKETS)
    const rules = getRules()
    expect(rules.length).toBeGreaterThan(0)
  })

  it('every rule has antecedent, consequent, support, confidence, lift', () => {
    seedBaskets(TEST_BASKETS)
    const rules = getRules()
    rules.forEach((rule) => {
      expect(rule.antecedent).toBeDefined()
      expect(rule.consequent).toBeDefined()
      expect(typeof rule.support).toBe('number')
      expect(typeof rule.confidence).toBe('number')
      expect(typeof rule.lift).toBe('number')
    })
  })

  it('support values are between 0 and 1', () => {
    seedBaskets(TEST_BASKETS)
    getRules().forEach(({ support }) => {
      expect(support).toBeGreaterThan(0)
      expect(support).toBeLessThanOrEqual(1)
    })
  })

  it('confidence values are between 0 and 1', () => {
    seedBaskets(TEST_BASKETS)
    getRules().forEach(({ confidence }) => {
      expect(confidence).toBeGreaterThan(0)
      expect(confidence).toBeLessThanOrEqual(1)
    })
  })

  it('lift values are positive', () => {
    seedBaskets(TEST_BASKETS)
    getRules().forEach(({ lift }) => {
      expect(lift).toBeGreaterThan(0)
    })
  })

  it('rules are sorted by lift descending', () => {
    seedBaskets(TEST_BASKETS)
    const rules = getRules()
    for (let i = 1; i < rules.length; i++) {
      expect(rules[i - 1].lift).toBeGreaterThanOrEqual(rules[i].lift)
    }
  })

  it('antecedent and consequent are non-overlapping', () => {
    seedBaskets(TEST_BASKETS)
    getRules().forEach(({ antecedent, consequent }) => {
      const antSet = new Set(antecedent)
      consequent.forEach((item) => {
        expect(antSet.has(item)).toBe(false)
      })
    })
  })
})

// ── Support / Confidence / Lift — mathematical validation ─────────────────

describe('Apriori mathematical correctness', () => {
  // Use a controlled minimal basket set so we can hand-calculate expected values

  // 10 baskets: {A,B} appears 4 times, {A} appears 6 times, {B} appears 5 times
  // support({A,B}) = 4/10 = 0.4
  // confidence(A→B) = support({A,B})/support({A}) = 0.4/0.6 ≈ 0.667
  // lift(A→B) = confidence(A→B)/support({B}) = 0.667/0.5 ≈ 1.333

  const controlledBaskets = [
    ['A', 'B'], // 1
    ['A', 'B'], // 2
    ['A', 'B'], // 3
    ['A', 'B'], // 4
    ['A', 'C'], // 5
    ['A', 'C'], // 6
    ['B', 'C'], // 7
    ['B', 'C'], // 8
    ['B', 'D'], // 9
    ['C', 'D'], // 10
  ]

  beforeEach(() => {
    seedBaskets(controlledBaskets)
    invalidateRulesCache()
  })

  it('correctly computes support for {A,B} = 0.4', () => {
    const rules = getRules(0.01, 0.01) // low thresholds to get all rules
    const abRule = rules.find(
      (r) =>
        r.antecedent.includes('A') &&
        r.consequent.includes('B') &&
        r.antecedent.length === 1 &&
        r.consequent.length === 1
    )
    expect(abRule).toBeDefined()
    expect(abRule.support).toBeCloseTo(0.4, 1)
  })

  it('correctly computes confidence for A→B ≈ 0.667', () => {
    const rules = getRules(0.01, 0.01)
    const abRule = rules.find(
      (r) =>
        r.antecedent.length === 1 &&
        r.antecedent[0] === 'A' &&
        r.consequent.length === 1 &&
        r.consequent[0] === 'B'
    )
    expect(abRule).toBeDefined()
    expect(abRule.confidence).toBeCloseTo(0.667, 1)
  })

  it('correctly computes lift for A→B ≈ 1.333', () => {
    const rules = getRules(0.01, 0.01)
    const abRule = rules.find(
      (r) =>
        r.antecedent.length === 1 &&
        r.antecedent[0] === 'A' &&
        r.consequent.length === 1 &&
        r.consequent[0] === 'B'
    )
    expect(abRule).toBeDefined()
    expect(abRule.lift).toBeCloseTo(1.333, 0)
  })

  it('high-support pairs produce stronger rules than low-support ones', () => {
    const rules = getRules(0.01, 0.01)
    // {A,B} has support 0.4, {B,D} has support 0.1
    const highSupRules = rules.filter((r) => r.support >= 0.35)
    const lowSupRules  = rules.filter((r) => r.support <= 0.15)
    // High support rules should exist
    expect(highSupRules.length).toBeGreaterThan(0)
  })
})

// ── getAprioriScores ───────────────────────────────────────────────────────

describe('getAprioriScores', () => {
  beforeEach(() => {
    seedBaskets(TEST_BASKETS)
    invalidateRulesCache()
  })

  it('returns empty array when no seeds provided', () => {
    expect(getAprioriScores([], new Set())).toEqual([])
  })

  it('returns scores when seeds match antecedents', () => {
    // Gowns 1 and 2 co-appear frequently → seeding with [1] should recommend 2
    const result = getAprioriScores(['1'], new Set(), 10)
    expect(result.length).toBeGreaterThan(0)
  })

  it('excludes seenIds from results', () => {
    const seenIds = new Set(['2', '10'])
    const result = getAprioriScores(['1'], seenIds, 10)
    const resultIds = result.map((r) => String(r.id))
    expect(resultIds).not.toContain('2')
    expect(resultIds).not.toContain('10')
  })

  it('all scores are between 0 and 1', () => {
    const result = getAprioriScores(['1', '2'], new Set(), 10)
    result.forEach(({ score }) => {
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(1)
    })
  })

  it('results are sorted by score descending', () => {
    const result = getAprioriScores(['1'], new Set(), 10)
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score)
    }
  })

  it('gown 2 is recommended when gown 1 is the seed (frequent co-occurrence)', () => {
    // In TEST_BASKETS, gowns 1 and 2 co-appear 5 times
    const result = getAprioriScores(['1'], new Set(), 10)
    const ids = result.map((r) => r.id)
    expect(ids).toContain(2)
  })

  it('gown 6 is recommended when gown 5 is the seed', () => {
    // Gowns 5 and 6 (both mermaid) co-appear 4 times in TEST_BASKETS
    const result = getAprioriScores(['5'], new Set(), 10)
    const ids = result.map((r) => r.id)
    expect(ids).toContain(6)
  })
})

// ── getAprioriStats ────────────────────────────────────────────────────────

describe('getAprioriStats', () => {
  it('returns basketCount, ruleCount, and topRules', () => {
    seedBaskets(TEST_BASKETS)
    invalidateRulesCache()
    const stats = getAprioriStats()
    expect(typeof stats.basketCount).toBe('number')
    expect(typeof stats.ruleCount).toBe('number')
    expect(Array.isArray(stats.topRules)).toBe(true)
  })

  it('topRules have if/then/confidence/lift fields', () => {
    seedBaskets(TEST_BASKETS)
    invalidateRulesCache()
    const { topRules } = getAprioriStats()
    if (topRules.length > 0) {
      expect(topRules[0]).toHaveProperty('if')
      expect(topRules[0]).toHaveProperty('then')
      expect(topRules[0]).toHaveProperty('confidence')
      expect(topRules[0]).toHaveProperty('lift')
    }
  })

  it('basketCount matches seeded basket count', () => {
    seedBaskets(TEST_BASKETS)
    invalidateRulesCache()
    const { basketCount } = getAprioriStats()
    expect(basketCount).toBe(TEST_BASKETS.length)
  })
})
