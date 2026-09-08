import { APP_TIMEZONE } from '../lib/config'
import { formatYmd, isAutoArchived, operationalMilestones, quarantineState } from '../lib/dates'
import { ROOMS, type LegalStatus, type PplRow } from '../lib/types'
import { LEGAL_LABELS, escapeHtml, go, icon, sortPpl, statusClass } from './base'
import { invalidatePpl, loadPpl } from './store'

function operationalWarning(row: PplRow) {
  const state = quarantineState(row.data_depunerii)
  if (state.day > 22) return ''
  const milestones = operationalMilestones(row.data_depunerii).filter((item) => item.day >= Math.max(20, state.day))
  if (!milestones.length) return ''
  return `<div class="operational-warning" role="note"><strong>ATENȚIE – se împlinește în zi nelucrătoare</strong>${milestones.map((item) => `<span>Ziua ${item.day} cade ${escapeHtml(item.nonWorkingReason)} (${formatYmd(item.date)}). ${item.dueToday ? '<b>Necesită acțiune astăzi.</b>' : `Alertă anticipată: ${formatYmd(item.operationalDate)}.`}</span>`).join('')}</div>`
}

function updatedClock() {
  return new Intl.DateTimeFormat('ro-RO', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit' }).format(new Date())
}

export function pplCard(row: PplRow, statusLabelOverride?: string) {
  const state = quarantineState(row.data_depunerii)
  const archived = isAutoArchived(row.data_depunerii)
  const anomaly = !archived && state.day >= 23
  const statusLabel = archived ? 'Arhivat' : (statusLabelOverride ?? state.label)
  const statusCss = archived ? 'status status-archived' : statusClass(state.kind)
  return `<article class="ppl-card ${anomaly ? 'ppl-card-anomaly' : ''}" data-ppl-id="${row.id}" tabindex="0" role="button" aria-label="Deschide ${escapeHtml(row.nume_complet)}">
    <div class="ppl-card-head">
      <div>
        <h3>${escapeHtml(row.nume_complet)}</h3>
        <div class="meta-line"><strong>${escapeHtml(row.camera)}</strong><span>•</span><span>${escapeHtml(LEGAL_LABELS[row.situatie_juridica])}</span></div>
      </div>
      <span class="${statusCss}">${escapeHtml(statusLabel)}</span>
    </div>
    <div class="ppl-card-grid">
      <div><span>Depunere</span><strong>${formatYmd(row.data_depunerii)}</strong></div>
      <div><span>Ziua curentă</span><strong>Ziua ${state.day}</strong></div>
      <div><span>Data aplicării regimului provizoriu</span><strong>${formatYmd(row.data_aplicarii_regimului_provizoriu)}</strong></div>
    </div>
    ${anomaly ? '<div class="anomaly-note" role="alert"><strong>ATENȚIE</strong><span>Regimul provizoriu trebuia aplicat.</span></div>' : ''}
    ${operationalWarning(row)}
  </article>`
}

export function bindPplCards() {
  document.querySelectorAll<HTMLElement>('[data-ppl-id]').forEach((card) => {
    const open = () => go(`ppl/${card.dataset.pplId}`)
    card.addEventListener('click', open)
    card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } })
  })
}

export async function renderEvidencePage() {
  const page = document.querySelector<HTMLDivElement>('#page')!
  page.innerHTML = '<div class="loading">Se încarcă…</div>'
  try {
    const allRows = sortPpl(await loadPpl(true))
    const refreshedAt = updatedClock()
    const activeRows = allRows.filter((row) => !isAutoArchived(row.data_depunerii))
    const states = activeRows.map((row) => quarantineState(row.data_depunerii))
    const counts = {
      in: states.filter((s) => s.kind === 'in_quarantine').length,
      tomorrow: states.filter((s) => s.kind === 'tomorrow').length,
      today: states.filter((s) => s.kind === 'today').length,
      expired: states.filter((s) => s.kind === 'expired').length,
    }
    page.innerHTML = `
      <section class="page-head evidence-page-head"><div><h1>Evidență</h1><p>${activeRows.length} persoane active <span class="updated-at">• Actualizat: ${refreshedAt}</span></p></div><button class="btn btn-secondary evidence-refresh-btn" id="refresh-evidence" type="button">Actualizează</button></section>
      <div id="pull-refresh" class="pull-refresh" hidden>Trage pentru actualizare</div>
      <section class="stats-grid" aria-label="Rezumat">
        <div class="stat-card"><span>În carantină</span><strong>${counts.in}</strong></div>
        <div class="stat-card stat-warning"><span>Expiră mâine</span><strong>${counts.tomorrow}</strong></div>
        <div class="stat-card stat-danger"><span>Expiră astăzi</span><strong>${counts.today}</strong></div>
        <div class="stat-card stat-muted"><span>Expirate</span><strong>${counts.expired}</strong></div>
      </section>
      <section class="list-tools">
        <label class="search-box">${icon('search')}<input id="search-input" type="search" placeholder="Caută după nume" autocomplete="off" /></label>
        <button class="btn btn-secondary btn-filter" id="filter-btn" type="button">${icon('filter')} Filtre</button>
      </section>
      <div id="active-filters" class="active-filters"></div>
      <section id="ppl-list" class="ppl-list"></section>
      <dialog id="filters-dialog" class="bottom-sheet">
        <form method="dialog" class="sheet-card">
          <div class="sheet-handle"></div>
          <div class="sheet-head"><h2>Filtre</h2><button value="cancel" class="text-btn">Închide</button></div>
          <label>Camera<select id="filter-room"><option value="">Toate camerele</option>${ROOMS.map((r) => `<option value="${r}">${r}</option>`).join('')}</select></label>
          <label>Situație juridică<select id="filter-legal"><option value="">Toate</option><option value="arestat_preventiv">Arestat preventiv</option><option value="condamnat_definitiv">Condamnat definitiv</option></select></label>
          <label>Status<select id="filter-status"><option value="">Toate active</option><option value="expired">Expirate</option><option value="today">Expiră astăzi</option><option value="tomorrow">Expiră mâine</option><option value="in_quarantine">În carantină</option><option value="archived">Arhivat</option></select></label>
          <div class="sheet-actions"><button type="button" id="reset-filters" class="btn btn-secondary">Resetează</button><button value="apply" class="btn btn-primary">Aplică</button></div>
        </form>
      </dialog>`

    let query = ''; let room = ''; let legal = ''; let status = ''
    const list = document.querySelector<HTMLDivElement>('#ppl-list')!
    const chips = document.querySelector<HTMLDivElement>('#active-filters')!
    const filterDialog = document.querySelector<HTMLDialogElement>('#filters-dialog')!

    const draw = () => {
      const filtered = allRows.filter((row) => {
        const state = quarantineState(row.data_depunerii)
        const archived = isAutoArchived(row.data_depunerii)
        const matchesArchive = status === 'archived' ? archived : !archived
        const matchesStatus = !status || status === 'archived' || state.kind === status
        return matchesArchive && matchesStatus && (!query || row.nume_complet.toLocaleLowerCase('ro').includes(query)) && (!room || row.camera === room) && (!legal || row.situatie_juridica === legal)
      })
      list.innerHTML = filtered.length ? filtered.map((row) => pplCard(row)).join('') : '<div class="empty-state"><strong>Niciun rezultat</strong><span>Modifică termenul de căutare sau filtrele.</span></div>'
      const active = [room && `Camera ${room}`, legal && LEGAL_LABELS[legal as LegalStatus], status && ({ archived: 'Arhivat', expired: 'Expirate', today: 'Expiră astăzi', tomorrow: 'Expiră mâine', in_quarantine: 'În carantină' } as Record<string,string>)[status]].filter(Boolean)
      chips.innerHTML = active.map((value) => `<span class="chip">${escapeHtml(value)}</span>`).join('')
      bindPplCards()
    }

    const refreshEvidence = async () => {
      const button = document.querySelector<HTMLButtonElement>('#refresh-evidence')
      if (button) { button.disabled = true; button.textContent = 'Se actualizează…' }
      invalidatePpl()
      await renderEvidencePage()
    }

    draw()
    document.querySelector<HTMLInputElement>('#search-input')!.addEventListener('input', (event) => { query = (event.target as HTMLInputElement).value.trim().toLocaleLowerCase('ro'); draw() })
    document.querySelector('#filter-btn')!.addEventListener('click', () => filterDialog.showModal())
    document.querySelector('#refresh-evidence')!.addEventListener('click', () => { void refreshEvidence() })
    document.querySelector('#reset-filters')!.addEventListener('click', () => {
      room = legal = status = ''
      ;(document.querySelector<HTMLSelectElement>('#filter-room')!).value = ''
      ;(document.querySelector<HTMLSelectElement>('#filter-legal')!).value = ''
      ;(document.querySelector<HTMLSelectElement>('#filter-status')!).value = ''
      draw()
    })
    filterDialog.addEventListener('close', () => {
      if (filterDialog.returnValue === 'apply') {
        room = document.querySelector<HTMLSelectElement>('#filter-room')!.value
        legal = document.querySelector<HTMLSelectElement>('#filter-legal')!.value
        status = document.querySelector<HTMLSelectElement>('#filter-status')!.value
        draw()
      }
    })

    let touchStart: number | null = null
    let pullArmed = false
    const pullIndicator = document.querySelector<HTMLDivElement>('#pull-refresh')!
    page.ontouchstart = (event) => {
      if (window.scrollY > 0 || filterDialog.open) return
      touchStart = event.touches[0]?.clientY ?? null
      pullArmed = false
    }
    page.ontouchmove = (event) => {
      if (touchStart === null) return
      const delta = (event.touches[0]?.clientY ?? touchStart) - touchStart
      if (delta < 28) { pullIndicator.hidden = true; pullArmed = false; return }
      pullIndicator.hidden = false
      pullArmed = delta >= 78
      pullIndicator.textContent = pullArmed ? 'Eliberează pentru actualizare' : 'Trage pentru actualizare'
    }
    page.ontouchend = () => {
      const shouldRefresh = pullArmed
      touchStart = null
      pullArmed = false
      pullIndicator.hidden = true
      if (shouldRefresh) void refreshEvidence()
    }
  } catch {
    page.innerHTML = '<div class="error-state">Datele nu au putut fi încărcate.</div>'
  }
}
