import './style.css'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { getMyProfile } from './lib/api'
import { isAutoArchived, operationalMilestones, quarantineState } from './lib/dates'
import { disablePush, registerServiceWorker } from './lib/push'
import { supabase } from './lib/supabase'
import { icon, navItem, route } from './ui/base'
import { renderAlertsPage, renderSettingsPage } from './ui/alerts-settings'
import { renderEvidencePage } from './ui/evidence'
import { renderAddPage, renderDetailsPage } from './ui/ppl-form'
import { invalidatePpl, loadPpl } from './ui/store'

document.documentElement.dataset.regimReady = '1'

const app = document.querySelector<HTMLDivElement>('#app')!
let session: Session | null = null
let rendering = false

function renderOfflineBanner() {
  const existing = document.querySelector('.offline-banner')
  if (navigator.onLine) { existing?.remove(); return }
  if (!existing) {
    const banner = document.createElement('div')
    banner.className = 'offline-banner'
    banner.textContent = 'Fără conexiune. Datele PPL nu sunt disponibile offline.'
    document.body.prepend(banner)
  }
}

async function renderLogin(message = '') {
  app.innerHTML = `
    <main class="login-page"><section class="login-card" aria-labelledby="login-title">
      <div class="brand-mark">R</div><h1 id="login-title">REGIM</h1><p class="muted">Evidență carantină</p>
      ${message ? `<div class="form-error" role="alert">${message.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</div>` : ''}
      <form id="login-form" novalidate>
        <label>Email<input id="login-email" name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" required /></label>
        <label>Parolă<input id="login-password" name="password" type="password" autocomplete="current-password" required /></label>
        <button class="btn btn-primary btn-block" type="submit">Autentificare</button>
      </form>
    </section></main>`
  const form = document.querySelector<HTMLFormElement>('#login-form')!
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const email = document.querySelector<HTMLInputElement>('#login-email')!.value.trim()
    const password = document.querySelector<HTMLInputElement>('#login-password')!.value
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]')!
    form.querySelector('.form-error')?.remove()
    if (!email || !password) { form.insertAdjacentHTML('afterbegin','<div class="form-error" role="alert">Completează emailul și parola.</div>'); return }
    if (!navigator.onLine) { form.insertAdjacentHTML('afterbegin','<div class="form-error" role="alert">Nu există conexiune la internet.</div>'); return }
    button.disabled = true; button.textContent = 'Se autentifică…'
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      button.disabled = false; button.textContent = 'Autentificare'
      form.insertAdjacentHTML('afterbegin','<div class="form-error" role="alert">Email sau parolă incorecte.</div>')
    }
  })
}

async function renderShell() {
  const rows = await loadPpl().catch(() => [])
  const alerts = rows.filter((row) => !isAutoArchived(row.data_depunerii) && (quarantineState(row.data_depunerii).day >= 20 || operationalMilestones(row.data_depunerii).some((m) => m.dueToday))).length
  const [top] = route()
  app.innerHTML = `<div class="app-shell">
    <header class="topbar"><div><div class="topbar-brand">REGIM</div><div class="topbar-subtitle">Evidență carantină</div></div><button class="icon-btn" id="logout-btn" type="button" aria-label="Deconectare">${icon('logout')}</button></header>
    <main id="page" class="page"></main>
    <nav class="bottom-nav" aria-label="Navigare principală">
      ${navItem('evidenta','Evidență','list',top === 'evidenta' || top === 'ppl')}
      ${navItem('adauga','Adaugă','plus',top === 'adauga')}
      ${navItem('alerte','Alerte','bell',top === 'alerte',alerts)}
      ${navItem('setari','Setări','settings',top === 'setari')}
    </nav></div>`
  document.querySelector('#logout-btn')?.addEventListener('click', async () => {
    try { await disablePush() } catch { /* best effort */ }
    await supabase.auth.signOut(); invalidatePpl()
  })
  document.querySelectorAll<HTMLElement>('[data-route]').forEach((item) => item.addEventListener('click', () => { location.hash = `#/${item.dataset.route}` }))
}

function renderOfflineShell() {
  invalidatePpl()
  app.innerHTML = `<div class="app-shell">
    <header class="topbar"><div><div class="topbar-brand">REGIM</div><div class="topbar-subtitle">Evidență carantină</div></div><button class="icon-btn" id="offline-logout" type="button" aria-label="Deconectare">${icon('logout')}</button></header>
    <main class="page"><section class="empty-state offline-state"><h1>Fără conexiune</h1><p>Datele de evidență nu sunt stocate offline. Reconectează telefonul pentru a continua.</p></section></main>
    <nav class="bottom-nav" aria-label="Navigare indisponibilă offline">${navItem('evidenta','Evidență','list',true)}${navItem('adauga','Adaugă','plus',false)}${navItem('alerte','Alerte','bell',false)}${navItem('setari','Setări','settings',false)}</nav>
  </div>`
  document.querySelectorAll<HTMLButtonElement>('.bottom-nav .nav-item').forEach((button) => { button.disabled = true })
  document.querySelector('#offline-logout')?.addEventListener('click', async () => {
    try { await disablePush() } catch { /* best effort */ }
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    session = null; invalidatePpl(); await renderLogin()
  })
}

async function renderAuthenticated() {
  if (!navigator.onLine) { renderOfflineShell(); return }
  const { data: verified, error } = await supabase.auth.getUser()
  if (error || !verified.user) { session = null; await supabase.auth.signOut().catch(() => undefined); await renderLogin('Sesiunea a expirat. Autentifică-te din nou.'); return }
  const profile = await getMyProfile().catch(() => null)
  if (!profile?.active) {
    app.innerHTML = '<main class="login-page"><section class="login-card"><h1>REGIM</h1><div class="form-error">Contul nu este activ sau nu are profil de acces.</div><button id="blocked-logout" class="btn btn-secondary btn-block">Deconectare</button></section></main>'
    document.querySelector('#blocked-logout')?.addEventListener('click', async () => { try { await disablePush() } catch {} await supabase.auth.signOut() })
    return
  }
  await renderShell()
  const [pageName,id] = route()
  if (pageName === 'adauga') await renderAddPage()
  else if (pageName === 'alerte') await renderAlertsPage()
  else if (pageName === 'setari') await renderSettingsPage()
  else if (pageName === 'ppl' && id) await renderDetailsPage(id)
  else await renderEvidencePage()
}

async function renderCurrentRoute() {
  if (rendering) return
  rendering = true
  try { renderOfflineBanner(); if (!session) await renderLogin(); else await renderAuthenticated() } finally { rendering = false }
}

async function init() {
  void registerServiceWorker().catch(() => undefined)
  const { data } = await supabase.auth.getSession(); session = data.session
  supabase.auth.onAuthStateChange((_event: AuthChangeEvent, nextSession: Session | null) => { session = nextSession; if (!nextSession) invalidatePpl(); queueMicrotask(() => void renderCurrentRoute()) })
  window.addEventListener('hashchange', () => void renderCurrentRoute())
  window.addEventListener('regim:refresh', () => void renderCurrentRoute())
  window.addEventListener('online', () => void renderCurrentRoute())
  window.addEventListener('offline', () => { invalidatePpl(); void renderCurrentRoute() })
  const viewport = window.visualViewport
  if (viewport) {
    const updateKeyboardState = () => document.body.classList.toggle('keyboard-open', window.innerHeight - viewport.height > 140)
    viewport.addEventListener('resize', updateKeyboardState); viewport.addEventListener('scroll', updateKeyboardState)
  }
  if (!location.hash) location.hash = '#/evidenta'
  await renderCurrentRoute()
}

void init().catch(async () => {
  session = null
  await renderLogin('Aplicația nu a putut inițializa sesiunea. Reîncearcă autentificarea.')
})
