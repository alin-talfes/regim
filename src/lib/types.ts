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

export interface NotificationPreferences {
  user_id: string
  enabled: boolean
  notification_days: number[]
  notification_time: string
  timezone: 'Europe/Bucharest'
}
