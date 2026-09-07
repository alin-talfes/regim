import { APP_BASE } from './config'
import { supabase } from './supabase'

function base64UrlToArrayBuffer(base64Url: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes.buffer as ArrayBuffer
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms)
    promise.then((value) => { window.clearTimeout(timer); resolve(value) }, (error) => { window.clearTimeout(timer); reject(error) })
  })
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  const existing = await withTimeout(navigator.serviceWorker.getRegistration(APP_BASE), 3000, 'Service worker lookup timed out').catch(() => undefined)
  const registration = existing ?? await withTimeout(
    navigator.serviceWorker.register(`${APP_BASE}sw.js`, { scope: APP_BASE, updateViaCache: 'none' }),
    6000,
    'Service worker registration timed out',
  )
  void registration.update().catch(() => undefined)
  return registration
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const registration = await withTimeout(navigator.serviceWorker.getRegistration(APP_BASE), 3000, 'Service worker lookup timed out').catch(() => undefined)
  if (!registration) return null
  return withTimeout(registration.pushManager.getSubscription(), 3000, 'Push subscription lookup timed out').catch(() => null)
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('Push notifications are not supported')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted')

  const { data: config, error: configError } = await supabase.functions.invoke('push-config', { method: 'POST' })
  if (configError || !config?.publicKey) throw configError ?? new Error('Push configuration unavailable')

  const registration = await registerServiceWorker()
  if (!registration) throw new Error('Service worker unavailable')
  let subscription = await withTimeout(registration.pushManager.getSubscription(), 3000, 'Push subscription lookup timed out')
  if (!subscription) {
    subscription = await withTimeout(registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToArrayBuffer(config.publicKey),
    }), 10000, 'Push subscription timed out')
  }

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('Incomplete push subscription')
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw userError ?? new Error('Session unavailable')

  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userData.user.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    enabled: true,
    user_agent: navigator.userAgent.slice(0, 500),
  }, { onConflict: 'user_id,endpoint' })
  if (error) throw error
}

export async function disablePush(): Promise<void> {
  const subscription = await currentPushSubscription()
  if (!subscription) return
  const endpoint = subscription.endpoint
  let backendError: unknown = null
  try {
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
    if (error) backendError = error
  } finally {
    await subscription.unsubscribe().catch(() => false)
  }
  if (backendError) throw backendError
}
