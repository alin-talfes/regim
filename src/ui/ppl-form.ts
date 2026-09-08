import { archivePpl, createPpl, getPpl, getPplHistory, listRemovedPpl, updatePpl, type PplInput } from '../lib/api'
import { alertState, bucharestToday, formatYmd, isAutoArchived, isFutureDate, maskDateInput, parseDisplayDate, provisionalRegimeDate, quarantineExpiry } from '../lib/dates'
import { findPotentialDuplicates, uppercasePersonName, type DuplicateMatch } from '../lib/names'
import { ROOMS, type LegalStatus, type PplRow, type Room } from '../lib/types'
import { LEGAL_LABELS, escapeHtml, friendlyError, go, icon, refreshRoute, toast } from './base'
import { pplHistoryMarkup, pplRecordMetaMarkup } from './ppl-history'
import { invalidatePpl, loadPpl } from './store'

function roomOptions(selected = '') {
  return `<option value="">Selectează camera</option>${ROOMS.map((room) => `<option value="${room}" ${selected === room ? 'selected' : ''}>${room}</option>`).join('')}`
}

function legalOptions(selected = '') {
  return `<option value="">Selectează situația</option><option value="arestat_preventiv" ${selected === 'arestat_preventiv' ? 'selected' : ''}>Arestat preventiv</option><option value="condamnat_definitiv" ${selected === 'condamnat_definitiv' ? 'selected' : ''}>Condamnat definitiv</option>`
}

function operationalLabel(ymd: string) {
  const state = alertState(ymd)
  return state.kind === 'none' ? 'În carantină' : state.label
}

function formMarkup(values?: Partial<PplInput>, submitLabel = 'Adaugă PPL') {
  return `<form id="ppl-form" class="form-card" novalidate>
    <label>Nume complet<input id="field-name" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="160" value="${escapeHtml(uppercasePersonName(values?.nume_complet ?? ''))}" required /></label>
    <label>Camera<select id="field-room" required>${roomOptions(values?.camera ?? '')}</select></label>
    <label>Situație juridică<select id="field-legal" required>${legalOptions(values?.situatie_juridica ?? '')}</select></label>
    <label>Data depunerii în penitenciar
      <div class="date-row">
        <div class="date-input-shell">
          <input id="field-date" type="text" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="zz.ll.aaaa" value="${values?.data_depunerii ? formatYmd(values.data_depunerii) : ''}" required />
          <span class="date-picker-control" title="Alege data din calendar">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>
            <input id="field-date-picker" type="date" max="${bucharestToday()}" value="${values?.data_depunerii ?? ''}" aria-label="Alege data depunerii din calendar" />
          </span>
        </div>
        <button id="today-btn" type="button" class="btn btn-secondary today-btn">AZI</button>
      </div>
      <span class="field-hint">Scrie zz.ll.aaaa sau alege data din calendar.</span>
    </label>
    <div id="date-error" class="field-error" aria-live="polite"></div>
    <div id="date-preview" class="date-preview" hidden></div>
    <button id="form-submit" class="btn btn-primary btn-block" type="submit" ${navigator.onLine ? '' : 'disabled'}>${submitLabel}</button>
  </form>`
}

function archivedReadOnlyMarkup(row: PplRow) {
  return `<section aria-label="Date arhivate">
    <div class="operational-policy-note"><strong>Arhivat:</strong> persoana a fost scoasă manual din evidența activă. Datele și istoricul sunt păstrate doar pentru consultare.</div>
    <div class="record-meta">
      <div><span>Nume complet</span><strong>${escapeHtml(row.nume_complet)}</strong></div>
      <div><span>Camera</span><strong>${escapeHtml(row.camera)}</strong></div>
      <div><span>Situație juridică</span><strong>${escapeHtml(LEGAL_LABELS[row.situatie_juridica])}</strong></div>
      <div><span>Data depunerii</span><strong>${escapeHtml(formatYmd(row.data_depunerii))}</strong></div>
    </div>
  </section>`
}

function bindNameField(onChange?: () => void) {
  const input = document.querySelector<HTMLInputElement>('#field-name')!
  input.addEventListener('input', () => {
    const start = input.selectionStart
    const end = input.selectionEnd
    input.value = uppercasePersonName(input.value)
    if (start !== null && end !== null) input.setSelectionRange(start, end)
    onChange?.()
  })
  input.value = uppercasePersonName(input.value)
}

function bindDateField(onChange?: () => void, rejectArchivedDate = false) {
  const input = document.querySelector<HTMLInputElement>('#field-date')!
  const picker = document.querySelector<HTMLInputElement>('#field-date-picker')!
  const error = document.querySelector<HTMLDivElement>('#date-error')!
  const preview = document.querySelector<HTMLDivElement>('#date-preview')!
  const update = () => {
    const ymd = parseDisplayDate(input.value)
    const pickerValue = ymd ?? ''
    if (picker.value !== pickerValue) picker.value = pickerValue
    error.textContent = ''
    if (input.value.length === 10 && !ymd) error.textContent = 'Data introdusă nu este validă.'
    if (ymd && isFutureDate(ymd)) error.textContent = 'Data depunerii nu poate fi în viitor.'
    if (ymd && !isFutureDate(ymd) && rejectArchivedDate && isAutoArchived(ymd)) error.textContent = 'Nu poți adăuga o persoană aflată deja în Ziua 31 sau ulterior. Aceasta aparține arhivei.'
    if (ymd && !isFutureDate(ymd)) {
      const day21 = quarantineExpiry(ymd)
      const provisionalDate = provisionalRegimeDate(ymd)
      preview.hidden = false
      preview.innerHTML = `<div><span>Ziua 21</span><strong>${formatYmd(day21)}</strong></div><div><span>Data aplicării regimului</span><strong>${formatYmd(provisionalDate)}</strong></div>`
    } else preview.hidden = true
    onChange?.()
  }
  input.addEventListener('input', () => { input.value = maskDateInput(input.value); update() })
  picker.addEventListener('change', () => {
    if (!picker.value) return
    input.value = formatYmd(picker.value)
    update()
  })
  document.querySelector('#today-btn')!.addEventListener('click', () => { input.value = formatYmd(bucharestToday()); update(); input.focus() })
  update()
}

function readPplForm(rejectArchivedDate = false): { input: PplInput | null; error?: string } {
  const name = uppercasePersonName(document.querySelector<HTMLInputElement>('#field-name')!.value).trim()
  const room = document.querySelector<HTMLSelectElement>('#field-room')!.value as Room
  const legal = document.querySelector<HTMLSelectElement>('#field-legal')!.value as LegalStatus
  const ymd = parseDisplayDate(document.querySelector<HTMLInputElement>('#field-date')!.value)
  if (!name) return { input: null, error: 'Introdu numele complet.' }
  if (!ROOMS.includes(room)) return { input: null, error: 'Selectează o cameră validă.' }
  if (!['arestat_preventiv', 'condamnat_definitiv'].includes(legal)) return { input: null, error: 'Selectează situația juridică.' }
  if (!ymd) return { input: null, error: 'Introdu o dată validă în format zz.ll.aaaa.' }
  if (isFutureDate(ymd)) return { input: null, error: 'Data depunerii nu poate fi în viitor.' }
  if (rejectArchivedDate && isAutoArchived(ymd)) return { input: null, error: 'Nu poți adăuga o persoană aflată deja în Ziua 31 sau ulterior. Aceasta aparține arhivei.' }
  return { input: { nume_complet: name, camera: room, situatie_juridica: legal, data_depunerii: ymd } }
}

function duplicateDialogMarkup() {
  return `<dialog id="duplicate-dialog" class="confirm-dialog"><form method="dialog" class="confirm-card"><h2>Posibil duplicat</h2><p>Există deja o persoană cu același nume sau foarte asemănător. Verifică înainte de adăugare.</p><div id="duplicate-list" class="duplicate-list"></div><div class="confirm-actions"><button value="cancel" class="btn btn-secondary">Anulează</button><button value="continue" class="btn btn-primary">Adaugă oricum</button></div></form></dialog>`
}

function dateChangeDialogMarkup() {
  return `<dialog id="date-change-dialog" class="confirm-dialog"><form method="dialog" class="confirm-card"><h2>Confirmă modificarea datei</h2><p id="date-change-confirm-text"></p><div class="confirm-actions"><button value="cancel" class="btn btn-secondary">Anulează</button><button value="continue" class="btn btn-primary">Confirmă modificarea</button></div></form></dialog>`
}

function waitForDialog(dialog: HTMLDialogElement, acceptedValue = 'continue'): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === acceptedValue), { once: true })
    dialog.showModal()
  })
}

async function confirmPotentialDuplicate(matches: DuplicateMatch[]) {
  const dialog = document.querySelector<HTMLDialogElement>('#duplicate-dialog')!
  const list = document.querySelector<HTMLDivElement>('#duplicate-list')!
  list.innerHTML = matches.slice(0, 4).map(({ row }) => {
    const status = row.deleted_at ? 'Arhivat – scos din evidență' : operationalLabel(row.data_depunerii)
    return `<div class="duplicate-match"><strong>${escapeHtml(row.nume_complet)}</strong><span>Camera ${escapeHtml(row.camera)} · ${escapeHtml(status)}</span></div>`
  }).join('')
  return waitForDialog(dialog)
}

async function confirmDateChange(oldDate: string, newDate: string) {
  const dialog = document.querySelector<HTMLDialogElement>('#date-change-dialog')!
  const text = document.querySelector<HTMLParagraphElement>('#date-change-confirm-text')!
  const oldStatus = operationalLabel(oldDate)
  const newStatus = operationalLabel(newDate)
  text.textContent = oldStatus === newStatus
    ? `Modifici data depunerii din ${formatYmd(oldDate)} în ${formatYmd(newDate)}. Verifică atent documentul înainte de confirmare.`
    : `Modifici data depunerii din ${formatYmd(oldDate)} în ${formatYmd(newDate)}. Această modificare schimbă statusul persoanei din „${oldStatus}” în „${newStatus}”.`
  return waitForDialog(dialog)
}

export async function renderAddPage() {
  const page = document.querySelector<HTMLDivElement>('#page')!
  page.innerHTML = `<section class="page-head"><div><h1>Adaugă PPL</h1><p>Completează datele de evidență.</p></div></section><div class="operational-policy-note"><strong>Regulă arhivare:</strong> nu poți adăuga o persoană care, raportat la data depunerii, este deja în Ziua 31 sau ulterior. Începând cu Ziua 31, persoanele existente sunt considerate arhivate și nu mai apar implicit în evidența activă.</div>${formMarkup()}${duplicateDialogMarkup()}`
  bindNameField()
  bindDateField(undefined, true)
  const form = document.querySelector<HTMLFormElement>('#ppl-form')!
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!navigator.onLine) return toast('Fără conexiune. Salvarea este dezactivată.', 'error')
    const result = readPplForm(true)
    if (!result.input) return toast(result.error!, 'error')
    const button = document.querySelector<HTMLButtonElement>('#form-submit')!
    button.disabled = true; button.textContent = 'Se verifică…'
    try {
      const [visibleRows, removedRows] = await Promise.all([loadPpl(true), listRemovedPpl()])
      const matches = findPotentialDuplicates(result.input.nume_complet, [...visibleRows, ...removedRows])
      if (matches.length && !(await confirmPotentialDuplicate(matches))) {
        button.disabled = false; button.textContent = 'Adaugă PPL'
        return
      }
      button.textContent = 'Se salvează…'
      await createPpl(result.input)
      invalidatePpl()
      toast('Persoana a fost adăugată.')
      go('evidenta')
    } catch (error) {
      button.disabled = false; button.textContent = 'Adaugă PPL'
      toast(friendlyError(error), 'error')
    }
  })
}

export async function renderDetailsPage(id: string) {
  const page = document.querySelector<HTMLDivElement>('#page')!
  page.innerHTML = '<div class="loading">Se încarcă…</div>'
  const row = await getPpl(id).catch(() => null)
  if (!row) {
    page.innerHTML = '<div class="error-state">Persoana nu a fost găsită.</div>'
    return
  }

  let historyUnavailable = false
  const history = await getPplHistory(id).catch(() => { historyUnavailable = true; return [] })
  const manuallyRemoved = Boolean(row.deleted_at)
  const archived = manuallyRemoved || isAutoArchived(row.data_depunerii)
  const original = { nume_complet: uppercasePersonName(row.nume_complet), camera: row.camera, situatie_juridica: row.situatie_juridica, data_depunerii: row.data_depunerii }
  page.innerHTML = `
    <section class="detail-head"><button class="icon-btn back-btn" id="back-btn" aria-label="Înapoi">${icon('back')}</button><div><h1>Detalii PPL</h1><p>${escapeHtml(row.nume_complet)}</p></div>${archived ? '<span class="status status-archived">Arhivat</span>' : ''}</section>
    ${pplRecordMetaMarkup(row, history)}
    ${manuallyRemoved ? archivedReadOnlyMarkup(row) : `
      <div id="unsaved" class="unsaved" hidden>Ai modificări nesalvate.</div>
      <div id="date-change-warning" class="date-change-warning" hidden></div>
      ${formMarkup(original, 'Salvează modificările')}`}
    ${pplHistoryMarkup(row, history, historyUnavailable)}
    ${manuallyRemoved ? '' : `
      <button id="delete-btn" class="btn btn-danger-outline btn-block destructive" type="button" ${navigator.onLine ? '' : 'disabled'}>Șterge din evidență</button>
      <dialog id="delete-dialog" class="confirm-dialog"><form method="dialog" class="confirm-card"><h2>Confirmare ștergere</h2><p>Sigur dorești să scoți persoana <strong>${escapeHtml(row.nume_complet)}</strong> din evidență?</p><div class="delete-retention-note">Această acțiune nu elimină definitiv datele din baza de date. Istoricul rămâne păstrat și persoana va putea fi consultată prin filtrul Arhivat.</div><div class="confirm-actions"><button value="cancel" class="btn btn-secondary">Anulează</button><button value="delete" class="btn btn-danger">Confirmă ștergerea</button></div></form></dialog>
      ${dateChangeDialogMarkup()}`}`
  document.querySelector('#back-btn')!.addEventListener('click', () => go('evidenta'))
  if (manuallyRemoved) return

  const dirty = () => {
    const currentDateValue = document.querySelector<HTMLInputElement>('#field-date')!.value
    const changed = document.querySelector<HTMLInputElement>('#field-name')!.value.trim() !== original.nume_complet
      || document.querySelector<HTMLSelectElement>('#field-room')!.value !== original.camera
      || document.querySelector<HTMLSelectElement>('#field-legal')!.value !== original.situatie_juridica
      || currentDateValue !== formatYmd(original.data_depunerii)
    document.querySelector<HTMLDivElement>('#unsaved')!.hidden = !changed

    const warning = document.querySelector<HTMLDivElement>('#date-change-warning')!
    const currentDate = parseDisplayDate(currentDateValue)
    if (!currentDate || currentDate === original.data_depunerii) {
      warning.hidden = true
      warning.textContent = ''
      return
    }
    const oldStatus = operationalLabel(original.data_depunerii)
    const newStatus = operationalLabel(currentDate)
    warning.hidden = false
    warning.textContent = oldStatus === newStatus
      ? `ATENȚIE: data depunerii a fost schimbată din ${formatYmd(original.data_depunerii)} în ${formatYmd(currentDate)}. Verifică documentul înainte de salvare.`
      : `ATENȚIE: data depunerii a fost schimbată din ${formatYmd(original.data_depunerii)} în ${formatYmd(currentDate)}. Această modificare schimbă statusul persoanei din „${oldStatus}” în „${newStatus}”.`
  }

  bindNameField(dirty)
  bindDateField(dirty)
  document.querySelectorAll('#ppl-form input:not(#field-name), #ppl-form select').forEach((el) => el.addEventListener('input', dirty))

  const form = document.querySelector<HTMLFormElement>('#ppl-form')!
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!navigator.onLine) return toast('Fără conexiune. Salvarea este dezactivată.', 'error')
    const result = readPplForm()
    if (!result.input) return toast(result.error!, 'error')
    if (result.input.data_depunerii !== original.data_depunerii && !(await confirmDateChange(original.data_depunerii, result.input.data_depunerii))) return
    const button = document.querySelector<HTMLButtonElement>('#form-submit')!
    button.disabled = true; button.textContent = 'Se salvează…'
    try {
      await updatePpl(id, result.input)
      invalidatePpl()
      toast('Modificările au fost salvate.')
      refreshRoute()
    } catch (error) {
      button.disabled = false; button.textContent = 'Salvează modificările'
      toast(friendlyError(error), 'error')
    }
  })

  const dialog = document.querySelector<HTMLDialogElement>('#delete-dialog')!
  document.querySelector('#delete-btn')!.addEventListener('click', () => dialog.showModal())
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'delete') return
    const deleteButton = document.querySelector<HTMLButtonElement>('#delete-btn')!
    deleteButton.disabled = true
    try {
      await archivePpl(id)
      invalidatePpl()
      toast('Persoana a fost scoasă din evidența activă.')
      go('evidenta')
    } catch (error) {
      deleteButton.disabled = false
      toast(friendlyError(error), 'error')
    }
  })
}
