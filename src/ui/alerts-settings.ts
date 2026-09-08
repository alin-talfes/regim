import { getNotificationPreferences, updateNotificationPreferences } from '../lib/api'
import { alertState, operationalMilestones } from '../lib/dates'
import { currentPushSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported } from '../lib/push'
import { friendlyError, refreshRoute, sortPpl, toast } from './base'
import { bindPplCards, pplCard } from './evidence'
import { loadPpl } from './store'

export async function renderAlertsPage() {
  const page = document.querySelector<HTMLDivElement>('#page')!
  page.innerHTML = '<div class="loading">Se încarcă…</div>'
  try {
    const rows = sortPpl(await loadPpl())
    const earlyRows = rows.filter((r) => operationalMilestones(r.data_depunerii).some((m) => m.dueToday))
    const earlyIds = new Set(earlyRows.map((r) => r.id))
    const groups = [
      { title: 'ATENȚIE – se împlinește în zi nelucrătoare', rows: earlyRows, statusLabel: undefined },
      { title: 'Expiră mâine', rows: rows.filter((r) => !earlyIds.has(r.id) && alertState(r.data_depunerii).kind === 'tomorrow'), statusLabel: 'Expiră mâine' },
      { title: 'Expiră astăzi', rows: rows.filter((r) => !earlyIds.has(r.id) && alertState(r.data_depunerii).kind === 'today'), statusLabel: 'Expiră astăzi' },
      { title: 'De aplicat regim provizoriu astăzi', rows: rows.filter((r) => !earlyIds.has(r.id) && alertState(r.data_depunerii).kind === 'provisional_today'), statusLabel: 'De aplicat regim provizoriu astăzi' },
      { title: 'Expirat', rows: rows.filter((r) => !earlyIds.has(r.id) && alertState(r.data_depunerii).kind === 'expired'), statusLabel: 'Expirat' },
    ]
    page.innerHTML = `<section class="page-head"><div><h1>Alerte</h1><p>Carantine care necesită atenție în programul L–V.</p></div></section>
      ${groups.map((group, index) => `<section class="alert-group ${index === 0 && group.rows.length ? 'alert-group-priority' : ''}"><div class="group-title"><h2>${group.title}</h2><span>${group.rows.length}</span></div>${group.rows.length ? `<div class="ppl-list">${group.rows.map((row) => pplCard(row, group.statusLabel)).join('')}</div>` : '<div class="empty-inline">Nicio persoană.</div>'}</section>`).join('')}`
    bindPplCards()
  } catch {
    page.innerHTML = '<div class="error-state">Alertele nu au putut fi încărcate.</div>'
  }
}

export async function renderSettingsPage() {
  const page = document.querySelector<HTMLDivElement>('#page')!
  page.innerHTML = '<div class="loading">Se încarcă…</div>'
  try {
    const prefs = await getNotificationPreferences()
    const subscription = await currentPushSubscription().catch(() => null)
    const iosNeedsInstall = isIos() && !isStandalone()
    const supported = pushSupported()
    page.innerHTML = `
      <section class="page-head"><div><h1>Setări</h1><p>Notificări per utilizator.</p></div></section>
      <section class="settings-card">
        <div class="setting-row"><div><strong>Notificări</strong><span>Activează sau dezactivează toate alertele.</span></div><label class="switch"><input id="notif-enabled" type="checkbox" ${prefs.enabled ? 'checked' : ''}/><span></span></label></div>
        <div class="setting-block"><strong>Zile notificare</strong>
          ${[20,21,22,23].map((day) => `<label class="check-row"><input class="day-check" type="checkbox" value="${day}" ${prefs.notification_days.includes(day) ? 'checked' : ''}/><span>Ziua ${day}${day === 20 ? ' – expiră mâine' : day === 21 ? ' – expiră astăzi' : day === 22 ? ' – aplicare regim provizoriu' : ' – regim provizoriu restant'}</span></label>`).join('')}
        </div>
        <div class="operational-policy-note">Dacă Ziua 20, 21 sau 22 cade sâmbătă, duminică ori într-o sărbătoare legală, notificarea se trimite în ultima zi lucrătoare anterioară, la ora setată. Ziua 23 se notifică numai dacă persoana este încă în evidența activă; persoanele arhivate nu generează notificări.</div>
        <label class="time-setting">Ora notificării<input id="notif-time" type="time" value="${prefs.notification_time.slice(0,5)}" /></label>
        <div class="timezone-note">Fus orar: Europe/Bucharest</div>
        <button id="save-settings" class="btn btn-primary btn-block" type="button" ${navigator.onLine ? '' : 'disabled'}>Salvează setările</button>
      </section>
      <section class="settings-card push-card">
        <div class="push-head"><div><strong>Notificări pe acest dispozitiv</strong><span>${subscription ? 'Dispozitiv abonat.' : 'Dispozitiv neabonat.'}</span></div><span class="device-status ${subscription ? 'on' : ''}">${subscription ? 'Activ' : 'Inactiv'}</span></div>
        ${iosNeedsInstall ? '<div class="ios-note">Pentru notificări pe iPhone, adaugă REGIM pe ecranul principal, apoi deschide aplicația instalată.</div>' : ''}
        ${!supported ? '<div class="form-error">Acest browser nu suportă Web Push.</div>' : ''}
        ${subscription ? '<button id="disable-push" class="btn btn-secondary btn-block">Dezactivează pe acest dispozitiv</button>' : `<button id="enable-push" class="btn btn-secondary btn-block" ${supported ? '' : 'disabled'}>Activează notificările</button>`}
      </section>`

    document.querySelector('#save-settings')!.addEventListener('click', async () => {
      if (!navigator.onLine) return toast('Fără conexiune.', 'error')
      const button = document.querySelector<HTMLButtonElement>('#save-settings')!
      const days = [...document.querySelectorAll<HTMLInputElement>('.day-check:checked')].map((el) => Number(el.value))
      const notificationTime = document.querySelector<HTMLInputElement>('#notif-time')!.value
      if (!days.length) return toast('Selectează cel puțin o zi de notificare.', 'error')
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(notificationTime)) return toast('Selectează o oră validă.', 'error')
      button.disabled = true; button.textContent = 'Se salvează…'
      try {
        await updateNotificationPreferences({ enabled: document.querySelector<HTMLInputElement>('#notif-enabled')!.checked, notification_days: days, notification_time: notificationTime })
        toast('Setările au fost salvate.')
        button.disabled = false; button.textContent = 'Salvează setările'
      } catch (error) {
        button.disabled = false; button.textContent = 'Salvează setările'
        toast(friendlyError(error), 'error')
      }
    })

    document.querySelector('#enable-push')?.addEventListener('click', async () => {
      if (iosNeedsInstall) return toast('Instalează mai întâi REGIM pe ecranul principal.', 'error')
      if (!navigator.onLine) return toast('Fără conexiune.', 'error')
      const button = document.querySelector<HTMLButtonElement>('#enable-push')!
      button.disabled = true; button.textContent = 'Se activează…'
      try {
        await enablePush()
        toast('Notificările au fost activate.')
        refreshRoute()
      } catch {
        button.disabled = false; button.textContent = 'Activează notificările'
        toast('Notificările nu au putut fi activate. Verifică permisiunile browserului.', 'error')
      }
    })

    document.querySelector('#disable-push')?.addEventListener('click', async () => {
      const button = document.querySelector<HTMLButtonElement>('#disable-push')!
      button.disabled = true
      try {
        await disablePush()
        toast('Notificările au fost dezactivate pe acest dispozitiv.')
        refreshRoute()
      } catch {
        button.disabled = false
        toast('Notificările nu au putut fi dezactivate.', 'error')
      }
    })
  } catch {
    page.innerHTML = '<div class="error-state">Setările nu au putut fi încărcate.</div>'
  }
}
