import { supabase } from './supabase'
import type { LegalStatus, NotificationPreferences, PplHistoryRow, PplRow, Room } from './types'

export interface PplInput {
  nume_complet: string
  camera: Room
  situatie_juridica: LegalStatus
  data_depunerii: string
}

export async function getMyProfile() {
  const { data, error } = await supabase.from('profiles').select('id,display_name,role,active').maybeSingle()
  if (error) throw error
  return data
}

export async function listPpl(): Promise<PplRow[]> {
  const { data, error } = await supabase
    .from('ppl')
    .select('id,nume_complet,camera,situatie_juridica,data_depunerii,data_aplicarii_regimului_provizoriu,created_at,created_by,updated_at,updated_by,deleted_at,deleted_by')
    .is('deleted_at', null)
    .order('data_aplicarii_regimului_provizoriu', { ascending: true })
  if (error) throw error
  return (data ?? []) as PplRow[]
}

export async function listRemovedPpl(): Promise<PplRow[]> {
  const { data, error } = await supabase.rpc('removed_ppl')
  if (error) throw error
  return (data ?? []) as PplRow[]
}

export async function getPpl(id: string): Promise<PplRow | null> {
  const { data, error } = await supabase
    .from('ppl')
    .select('id,nume_complet,camera,situatie_juridica,data_depunerii,data_aplicarii_regimului_provizoriu,created_at,created_by,updated_at,updated_by,deleted_at,deleted_by')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (data) return data as PplRow

  const { data: removed, error: removedError } = await supabase.rpc('removed_ppl_by_id', { p_id: id })
  if (removedError) throw removedError
  return ((removed ?? [])[0] ?? null) as PplRow | null
}

export async function getPplHistory(id: string): Promise<PplHistoryRow[]> {
  const { data, error } = await supabase.rpc('ppl_history', { p_id: id })
  if (error) throw error
  return (data ?? []) as PplHistoryRow[]
}

export async function createPpl(input: PplInput): Promise<string> {
  const { data, error } = await supabase.from('ppl').insert(input).select('id').single()
  if (error) throw error
  return data.id as string
}

export async function updatePpl(id: string, input: PplInput): Promise<void> {
  const { error } = await supabase.from('ppl').update(input).eq('id', id)
  if (error) throw error
}

export async function archivePpl(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('archive_ppl', { p_id: id })
  if (error) throw error
  if (data !== true) throw new Error('Persoana nu a putut fi ștearsă sau nu mai este activă.')
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('user_id,enabled,notification_days,notification_time,timezone')
    .single()
  if (error) throw error
  return data as NotificationPreferences
}

export async function updateNotificationPreferences(values: Pick<NotificationPreferences, 'enabled' | 'notification_days' | 'notification_time'>): Promise<void> {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) throw userError ?? new Error('Session unavailable')
  const { error } = await supabase
    .from('notification_preferences')
    .update(values)
    .eq('user_id', userData.user.id)
  if (error) throw error
}
