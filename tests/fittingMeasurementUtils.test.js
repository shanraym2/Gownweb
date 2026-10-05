import { describe, expect, it } from 'vitest'
import { aggregateMenScanSamples, estimateMeasurements, getFullHeightPxPerCm, MEN_SCAN_PROPORTIONS } from '../lib/fitting-room/measurementUtils'
import { SIZES_MEN } from '../app/constants/sizeConstants'

describe('getFullHeightPxPerCm', () => {
  it('corrects the men scale for nose-to-ankle height', () => {
    expect(getFullHeightPxPerCm(177, 200, 'men')).toBeCloseTo(1)
  })

  it('leaves the women scale unchanged', () => {
    expect(getFullHeightPxPerCm(177, 200, 'women')).toBeCloseTo(0.885)
  })

  it.each([100, 152.4, 165.1, 190.5, 248.92])(
    'uses the entered men height at %s cm rather than a fixed height',
    (heightCm) => {
      const expectedPxPerCm = 2.4
      const noseToAnklePx = heightCm * 0.885 * expectedPxPerCm

      expect(getFullHeightPxPerCm(noseToAnklePx, heightCm, 'men')).toBeCloseTo(expectedPxPerCm)
    }
  )
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

  it('uses the full retained sample set to reduce window-to-window drift', () => {
    const samples = Array.from({ length: 40 }, (_, index) => ({
      shoulderCm: index < 20 ? 30 : 50,
      hipCm: index < 20 ? 26 : 46,
      pxPerCm: index < 20 ? 1.5 : 2.5,
    }))

    expect(aggregateMenScanSamples(samples).shoulderCm).toBeCloseTo(40)
    expect(aggregateMenScanSamples(samples).hipCm).toBeCloseTo(36)
    expect(aggregateMenScanSamples(samples).pxPerCm).toBeCloseTo(2)
  })
})

describe('men scan sizing proportions', () => {
  it('maps a representative medium build to the medium chart range', () => {
    const shoulderCm = 42
    const hipJointSpanCm = 31
    const measurements = estimateMeasurements({
      shoulderCm,
      waistCm: shoulderCm * MEN_SCAN_PROPORTIONS.waistFromShoulder,
      hipCm: hipJointSpanCm * MEN_SCAN_PROPORTIONS.hipWidthFromJointSpan,
      segment: 'men',
    })
    const medium = SIZES_MEN.find(size => size.label === 'M')

    expect(measurements.bust).toBeGreaterThanOrEqual(medium.bust_min)
    expect(measurements.bust).toBeLessThanOrEqual(medium.bust_max)
    expect(measurements.waist).toBeGreaterThanOrEqual(medium.waist_min)
    expect(measurements.waist).toBeLessThanOrEqual(medium.waist_max)
    expect(measurements.hips).toBeGreaterThanOrEqual(medium.hip_min)
    expect(measurements.hips).toBeLessThanOrEqual(medium.hip_max)
  })
})