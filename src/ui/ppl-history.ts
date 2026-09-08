import { addCalendarDays, formatYmd, isAutoArchived } from '../lib/dates'
import type { LegalStatus, PplHistoryRow, PplRow } from '../lib/types'
import { LEGAL_LABELS, escapeHtml } from './base'

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function legalLabel(value: string | null): string {
  if (value === 'arestat_preventiv' || value === 'condamnat_definitiv') return LEGAL_LABELS[value as LegalStatus]
  return value || '—'
}

function actorName(event?: PplHistoryRow): string {
  return event?.actor_display_name?.trim() || '—'
}

function changesFor(event: PplHistoryRow): string[] {
  if (event.action === 'CREATE_PPL') return ['Persoană adăugată în evidență.']
  if (event.action === 'ARCHIVE_PPL') return ['Șters din evidență. Datele au rămas păstrate în baza de date.']
  if (event.action === 'RESTORE_PPL') return ['Persoană restaurată în evidență.']

  const changes: string[] = []
  if (event.old_camera !== event.new_camera && (event.old_camera || event.new_camera)) {
    changes.push(`Camera: ${event.old_camera || '—'} → ${event.new_camera || '—'}`)
  }
  if (event.old_situatie_juridica !== event.new_situatie_juridica && (event.old_situatie_juridica || event.new_situatie_juridica)) {
    changes.push(`Situație juridică: ${legalLabel(event.old_situatie_juridica)} → ${legalLabel(event.new_situatie_juridica)}`)
  }
  if (event.old_data_depunerii !== event.new_data_depunerii && (event.old_data_depunerii || event.new_data_depunerii)) {
    changes.push(`Data depunerii: ${event.old_data_depunerii ? formatYmd(event.old_data_depunerii) : '—'} → ${event.new_data_depunerii ? formatYmd(event.new_data_depunerii) : '—'}`)
  }
  return changes.length ? changes : ['Înregistrare actualizată.']
}

export function pplRecordMetaMarkup(row: PplRow, history: PplHistoryRow[]) {
  const createdEvent = history.find((event) => event.action === 'CREATE_PPL')
  const lastEvent = history.length ? history[history.length - 1] : undefined
  return `<section class="record-meta" aria-label="Metadate evidență">
    <div><span>Creat la</span><strong>${escapeHtml(formatDateTime(row.created_at))}</strong></div>
    <div><span>Creat de</span><strong>${escapeHtml(actorName(createdEvent))}</strong></div>
    <div><span>Modificat la</span><strong>${escapeHtml(formatDateTime(row.updated_at))}</strong></div>
    <div><span>Modificat de</span><strong>${escapeHtml(actorName(lastEvent ?? createdEvent))}</strong></div>
  </section>`
}

export function pplHistoryMarkup(row: PplRow, history: PplHistoryRow[], unavailable = false) {
  const events = history.map((event) => `<article class="history-item">
    <div class="history-dot"></div>
    <div class="history-body">
      <div class="history-head"><strong>${escapeHtml(event.action === 'CREATE_PPL' ? 'Creare' : event.action === 'UPDATE_PPL' ? 'Modificare' : event.action === 'ARCHIVE_PPL' ? 'Ștergere din evidență' : event.action === 'RESTORE_PPL' ? 'Restaurare' : event.action)}</strong><time>${escapeHtml(formatDateTime(event.event_at))}</time></div>
      ${changesFor(event).map((change) => `<div class="history-change">${escapeHtml(change)}</div>`).join('')}
      <div class="history-actor">Operat de: ${escapeHtml(actorName(event))}</div>
    </div>
  </article>`)

  if (isAutoArchived(row.data_depunerii)) {
    const archivedDate = addCalendarDays(row.data_depunerii, 30)
    events.push(`<article class="history-item history-item-system">
      <div class="history-dot"></div>
      <div class="history-body">
        <div class="history-head"><strong>Arhivare automată</strong><time>${escapeHtml(formatYmd(archivedDate))}</time></div>
        <div class="history-change">Arhivat automat – Ziua 31.</div>
        <div class="history-actor">Operat de: Sistem</div>
      </div>
    </article>`)
  }

  return `<section class="history-card" aria-label="Istoric persoană">
    <div class="history-title"><div><h2>Istoric</h2><p>Modificările sunt păstrate în jurnalul de audit.</p></div><span>${events.length}</span></div>
    ${unavailable ? '<div class="empty-inline">Istoricul nu a putut fi încărcat.</div>' : events.length ? `<div class="history-list">${events.join('')}</div>` : '<div class="empty-inline">Nu există evenimente înregistrate.</div>'}
  </section>`
}
