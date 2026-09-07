import { archivePpl, createPpl, getPpl, updatePpl, type PplInput } from '../lib/api'
import { bucharestToday, formatYmd, isFutureDate, maskDateInput, parseDisplayDate, provisionalRegimeDate, quarantineExpiry } from '../lib/dates'
import { ROOMS, type LegalStatus, type Room } from '../lib/types'
import { escapeHtml, friendlyError, go, icon, refreshRoute, toast } from './base'
import { invalidatePpl } from './store'

function roomOptions(selected = '') {
  return `<option value="">Selectează camera</option>${ROOMS.map((room) => `<option value="${room}" ${selected === room ? 'selected' : ''}>${room}</option>`).join('')}`
}

function legalOptions(selected = '') {
  return `<option value="">Selectează situația</option><option value="arestat_preventiv" ${selected === 'arestat_preventiv' ? 'selected' : ''}>Arestat preventiv</option><option value="condamnat_definitiv" ${selected === 'condamnat_definitiv' ? 'selected' : ''}>Condamnat definitiv</option>`
}

function formMarkup(values?: Partial<PplInput>, submitLabel = 'Adaugă PPL') {
  return `<form id="ppl-form" class="form-card" novalidate>
    <label>Nume complet<input id="field-name" type="text" autocomplete="off" maxlength="160" value="${escapeHtml(values?.nume_complet ?? '')}" required /></label>
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

function bindDateField(onChange?: () => void) {
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
    if (ymd && !isFutureDate(ymd)) {
      const day21 = quarantineExpiry(ymd)
      const provisionalDate = provisionalRegimeDate(ymd)
      preview.hidden = false
      preview.innerHTML = `<div><span>Ziua 21</span><strong>${formatYmd(day21)}</strong></div><div><span>Data aplicării regimului provizoriu</span><strong>${formatYmd(provisionalDate)}</strong></div>`
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

function readPplForm(): { input: PplInput | null; error?: string } {
  const name = document.querySelector<HTMLInputElement>('#field-name')!.value.trim()
  const room = document.querySelector<HTMLSelectElement>('#field-room')!.value as Room
  const legal = document.querySelector<HTMLSelectElement>('#field-legal')!.value as LegalStatus
  const ymd = parseDisplayDate(document.querySelector<HTMLInputElement>('#field-date')!.value)
  if (!name) return { input: null, error: 'Introdu numele complet.' }
  if (!ROOMS.includes(room)) return { input: null, error: 'Selectează o cameră validă.' }
  if (!['arestat_preventiv', 'condamnat_definitiv'].includes(legal)) return { input: null, error: 'Selectează situația juridică.' }
  if (!ymd) return { input: null, error: 'Introdu o dată validă în format zz.ll.aaaa.' }
  if (isFutureDate(ymd)) return { input: null, error: 'Data depunerii nu poate fi în viitor.' }
  return { input: { nume_complet: name, camera: room, situatie_juridica: legal, data_depunerii: ymd } }
}

export async function renderAddPage() {
  const page = document.querySelector<HTMLDivElement>('#page')!
  page.innerHTML = `<section class="page-head"><div><h1>Adaugă PPL</h1><p>Completează datele de evidență.</p></div></section>${formMarkup()}`
  bindDateField()
  const form = document.querySelector<HTMLFormElement>('#ppl-form')!
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!navigator.onLine) return toast('Fără conexiune. Salvarea este dezactivată.', 'error')
    const result = readPplForm()
    if (!result.input) return toast(result.error!, 'error')
    const button = document.querySelector<HTMLButtonElement>('#form-submit')!
    button.disabled = true; button.textContent = 'Se salvează…'
    try {
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
    page.innerHTML = '<div class="error-state">Persoana nu a fost găsită sau nu mai este activă.</div>'
    return
  }
  const original = { nume_complet: row.nume_complet, camera: row.camera, situatie_juridica: row.situatie_juridica, data_depunerii: row.data_depunerii }
  page.innerHTML = `
    <section class="detail-head"><button class="icon-btn back-btn" id="back-btn" aria-label="Înapoi">${icon('back')}</button><div><h1>Detalii PPL</h1><p>${escapeHtml(row.nume_complet)}</p></div></section>
    <div id="unsaved" class="unsaved" hidden>Ai modificări nesalvate.</div>
    ${formMarkup(original, 'Salvează modificările')}
    <button id="delete-btn" class="btn btn-danger-outline btn-block destructive" type="button" ${navigator.onLine ? '' : 'disabled'}>Șterge</button>
    <dialog id="delete-dialog" class="confirm-dialog"><form method="dialog" class="confirm-card"><h2>Confirmare ștergere</h2><p>Sigur dorești să ștergi persoana <strong>${escapeHtml(row.nume_complet)}</strong>?</p><div class="confirm-actions"><button value="cancel" class="btn btn-secondary">Anulează</button><button value="delete" class="btn btn-danger">Confirmă ștergerea</button></div></form></dialog>`
  document.querySelector('#back-btn')!.addEventListener('click', () => go('evidenta'))

  const dirty = () => {
    const changed = document.querySelector<HTMLInputElement>('#field-name')!.value.trim() !== original.nume_complet
      || document.querySelector<HTMLSelectElement>('#field-room')!.value !== original.camera
      || document.querySelector<HTMLSelectElement>('#field-legal')!.value !== original.situatie_juridica
      || document.querySelector<HTMLInputElement>('#field-date')!.value !== formatYmd(original.data_depunerii)
    document.querySelector<HTMLDivElement>('#unsaved')!.hidden = !changed
  }
  bindDateField(dirty)
  document.querySelectorAll('#ppl-form input, #ppl-form select').forEach((el) => el.addEventListener('input', dirty))

  const form = document.querySelector<HTMLFormElement>('#ppl-form')!
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!navigator.onLine) return toast('Fără conexiune. Salvarea este dezactivată.', 'error')
    const result = readPplForm()
    if (!result.input) return toast(result.error!, 'error')
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
      toast('Persoana a fost ștearsă din evidența activă.')
      go('evidenta')
    } catch (error) {
      deleteButton.disabled = false
      toast(friendlyError(error), 'error')
    }
  })
}
