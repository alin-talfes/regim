import { quarantineState } from '../lib/dates'
import type { LegalStatus, PplRow } from '../lib/types'

export const LEGAL_LABELS: Record<LegalStatus, string> = {
  arestat_preventiv: 'Arestat preventiv',
  condamnat_definitiv: 'Condamnat definitiv',
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function icon(name: 'list' | 'plus' | 'bell' | 'settings' | 'filter' | 'logout' | 'back' | 'search') {
  const paths = {
    list: '<path d="M5 6h14M5 12h14M5 18h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.36.38.7.7.95.3.25.7.4 1.1.4h.1v4h-.1c-.4 0-.8.15-1.1.4-.32.25-.55.59-.7.95Z"/>',
    filter: '<path d="M4 5h16l-6 7v5l-4 2v-7Z"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  }
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`
}

export function toast(message: string, kind: 'success' | 'error' = 'success') {
  const node = document.createElement('div')
  node.className = `toast toast-${kind}`
  node.textContent = message
  document.body.append(node)
  requestAnimationFrame(() => node.classList.add('show'))
  setTimeout(() => {
    node.classList.remove('show')
    setTimeout(() => node.remove(), 220)
  }, 2800)
}

export function friendlyError(_error: unknown) {
  return 'Datele nu au putut fi salvate. Încearcă din nou.'
}

export function route() {
  const raw = location.hash.replace(/^#\/?/, '')
  const parts = raw.split('/').filter(Boolean)
  return parts.length ? parts : ['evidenta']
}

export function go(path: string) {
  location.hash = `#/${path.replace(/^\//, '')}`
}

export function refreshRoute() {
  window.dispatchEvent(new Event('regim:refresh'))
}

export function sortPpl(rows: PplRow[]): PplRow[] {
  const rank = (row: PplRow) => {
    const kind = quarantineState(row.data_depunerii).kind
    if (kind === 'expired') return 0
    if (kind === 'today') return 1
    if (kind === 'tomorrow') return 2
    return 3
  }
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.data_aplicarii_regimului_provizoriu.localeCompare(b.data_aplicarii_regimului_provizoriu) || a.nume_complet.localeCompare(b.nume_complet, 'ro'))
}

export function statusClass(kind: ReturnType<typeof quarantineState>['kind']) {
  return `status status-${kind}`
}

export function navItem(path: string, label: string, iconName: Parameters<typeof icon>[0], active: boolean, badge = 0) {
  return `<button type="button" class="nav-item ${active ? 'active' : ''}" data-route="${path}" aria-current="${active ? 'page' : 'false'}">
    <span class="nav-icon">${icon(iconName)}${badge ? `<span class="nav-badge">${badge > 99 ? '99+' : badge}</span>` : ''}</span>
    <span>${label}</span>
  </button>`
}
