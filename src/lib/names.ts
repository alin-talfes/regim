import type { PplRow } from './types'

export function uppercasePersonName(value: string): string {
  return value.toLocaleUpperCase('ro-RO')
}

export function normalizePersonName(value: string): string {
  const clean = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleUpperCase('ro')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
  return clean.split(/\s+/).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ro')).join(' ')
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const previous: number[] = Array.from({ length: b.length + 1 }, (_, index) => index)
  const current: number[] = Array.from({ length: b.length + 1 }, () => 0)
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const insertion = (current[j - 1] ?? i) + 1
      const deletion = (previous[j] ?? j) + 1
      const substitution = (previous[j - 1] ?? j - 1) + cost
      current[j] = Math.min(insertion, deletion, substitution)
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j] ?? 0
  }
  return previous[b.length] ?? b.length
}

export function personNameSimilarity(a: string, b: string): number {
  const left = normalizePersonName(a)
  const right = normalizePersonName(b)
  if (!left || !right) return 0
  if (left === right) return 1
  const longest = Math.max(left.length, right.length)
  return longest ? 1 - levenshtein(left, right) / longest : 0
}

export interface DuplicateMatch {
  row: PplRow
  score: number
}

export function findPotentialDuplicates(name: string, rows: PplRow[]): DuplicateMatch[] {
  const normalized = normalizePersonName(name)
  if (normalized.length < 5) return []
  return rows
    .map((row) => ({ row, score: personNameSimilarity(name, row.nume_complet) }))
    .filter((item) => item.score === 1 || item.score >= 0.86)
    .sort((a, b) => b.score - a.score || a.row.nume_complet.localeCompare(b.row.nume_complet, 'ro'))
}
