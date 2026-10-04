import { describe, expect, it } from 'vitest'
import { aggregateMenScanSamples, getFullHeightPxPerCm } from '../lib/fitting-room/measurementUtils'

describe('getFullHeightPxPerCm', () => {
  it('corrects the men scale for nose-to-ankle height', () => {
    expect(getFullHeightPxPerCm(177, 200, 'men')).toBeCloseTo(1)
  })

  it('leaves the women scale unchanged', () => {
    expect(getFullHeightPxPerCm(177, 200, 'women')).toBeCloseTo(0.885)
  })
})

describe('aggregateMenScanSamples', () => {
  it('is order-independent for the same stable scan samples', () => {
    const samples = Array.from({ length: 12 }, (_, index) => ({
      shoulderCm: 44 + (index % 3) / 10,
      hipCm: 39 + (index % 2) / 10,
      pxPerCm: 2.5 + (index % 4) / 100,
    }))

    expect(aggregateMenScanSamples(samples)).toEqual(
      aggregateMenScanSamples([...samples].reverse())
    )
  })

  it('returns null when no clean samples are available', () => {
    expect(aggregateMenScanSamples([])).toBeNull()
  })
})