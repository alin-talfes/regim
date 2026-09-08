export const ROOMS = ['E1.14','E1.15','E1.16','E1.17','E1.18','E1.19','E1.20','E1.21','E1.22','E1.23','E1.24','E1.25'] as const
export type Room = typeof ROOMS[number]
export type LegalStatus = 'arestat_preventiv' | 'condamnat_definitiv'

export interface PplRow {
  id: string
  nume_complet: string
  camera: Room
  situatie_juridica: LegalStatus
  data_depunerii: string
  data_aplicarii_regimului_provizoriu: string
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string
  deleted_at: string | null
  deleted_by: string | null
}

export type PplAuditAction = 'CREATE_PPL' | 'UPDATE_PPL' | 'ARCHIVE_PPL' | 'RESTORE_PPL' | string

export interface PplHistoryRow {
  audit_id: number
  action: PplAuditAction
  event_at: string
  actor_user_id: string | null
  actor_display_name: string
  old_camera: string | null
  new_camera: string | null
  old_situatie_juridica: string | null
  new_situatie_juridica: string | null
  old_data_depunerii: string | null
  new_data_depunerii: string | null
}

export interface NotificationPreferences {
  user_id: string
  enabled: boolean
  notification_days: number[]
  notification_time: string
  timezone: 'Europe/Bucharest'
}
