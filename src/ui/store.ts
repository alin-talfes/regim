import { listPpl } from '../lib/api'
import type { PplRow } from '../lib/types'

let pplCache: PplRow[] | null = null

export async function loadPpl(force = false): Promise<PplRow[]> {
  if (!force && pplCache) return pplCache
  pplCache = await listPpl()
  return pplCache
}

export function invalidatePpl() {
  pplCache = null
}
