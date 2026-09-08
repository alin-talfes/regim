import { describe, expect, it } from 'vitest'
import { normalizePersonName, personNameSimilarity, uppercasePersonName } from './names'

describe('PPL name formatting', () => {
  it('forces Romanian names to uppercase', () => {
    expect(uppercasePersonName('Șerban Țepeș Ion')).toBe('ȘERBAN ȚEPEȘ ION')
    expect(uppercasePersonName('popescu ion')).toBe('POPESCU ION')
  })
})

describe('duplicate PPL name detection', () => {
  it('normalizes Romanian diacritics and token order', () => {
    expect(normalizePersonName('Șerban Țepeș Ion')).toBe(normalizePersonName('Ion Tepes Serban'))
  })

  it('treats reordered identical names as exact matches', () => {
    expect(personNameSimilarity('Popescu Ion', 'ION POPESCU')).toBe(1)
  })

  it('flags a small typo as highly similar', () => {
    expect(personNameSimilarity('Popescu Ion', 'Popescu Ioan')).toBeGreaterThanOrEqual(0.86)
  })

  it('keeps unrelated names below the warning threshold', () => {
    expect(personNameSimilarity('Popescu Ion', 'Ionescu Mihai')).toBeLessThan(0.86)
  })
})
