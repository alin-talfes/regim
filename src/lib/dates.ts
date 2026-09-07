import { APP_TIMEZONE } from './config'

const DAY_MS = 86_400_000

interface Parts { year: number; month: number; day: number }

function partsFromYmd(ymd: string): Parts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!match) return null
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  if (!isValidParts(year, month, day)) return null
  return { year, month, day }
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
}

function isValidParts(year: number, month: number, day: number) {
  return year >= 1900 && year <= 2200 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

function toUtcEpoch({ year, month, day }: Parts) {
  return Date.UTC(year, month - 1, day)
}

function ymdFromUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

export function maskDateInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`
}

export function parseDisplayDate(value: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value)
  if (!match) return null
  const day = Number(match[1]); const month = Number(match[2]); const year = Number(match[3])
  if (!isValidParts(year, month, day)) return null
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

export function formatYmd(ymd: string): string {
  const parts = partsFromYmd(ymd)
  if (!parts) return ''
  return `${parts.day.toString().padStart(2, '0')}.${parts.month.toString().padStart(2, '0')}.${parts.year}`
}

export function addCalendarDays(ymd: string, days: number): string {
  const parts = partsFromYmd(ymd)
  if (!parts) throw new Error('Invalid date-only value')
  return ymdFromUtcDate(new Date(toUtcEpoch(parts) + days * DAY_MS))
}

export function quarantineExpiry(depositYmd: string): string {
  return addCalendarDays(depositYmd, 20)
}

export function provisionalRegimeDate(depositYmd: string): string {
  return addCalendarDays(depositYmd, 21)
}

export function calendarDayDifference(fromYmd: string, toYmd: string): number {
  const from = partsFromYmd(fromYmd); const to = partsFromYmd(toYmd)
  if (!from || !to) throw new Error('Invalid date-only value')
  return Math.round((toUtcEpoch(to) - toUtcEpoch(from)) / DAY_MS)
}

export function quarantineDay(depositYmd: string, todayYmd: string): number {
  return calendarDayDifference(depositYmd, todayYmd) + 1
}

export function bucharestToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function orthodoxEaster(year: number): string {
  const a = year % 4
  const b = year % 7
  const c = year % 19
  const d = (19 * c + 15) % 30
  const e = (2 * a + 4 * b - d + 34) % 7
  const julianMonth = Math.floor((d + e + 114) / 31)
  const julianDay = ((d + e + 114) % 31) + 1
  const gregorianOffset = Math.floor(year / 100) - Math.floor(year / 400) - 2
  return ymdFromUtcDate(new Date(Date.UTC(year, julianMonth - 1, julianDay + gregorianOffset)))
}

const FIXED_HOLIDAYS: Record<string, string> = {
  '01-01': 'Anul Nou', '01-02': 'A doua zi de Anul Nou', '01-06': 'Boboteaza', '01-07': 'Sf. Ioan',
  '01-24': 'Ziua Unirii Principatelor Române', '05-01': 'Ziua Muncii', '06-01': 'Ziua Copilului',
  '08-15': 'Adormirea Maicii Domnului', '11-30': 'Sf. Andrei', '12-01': 'Ziua Națională a României',
  '12-25': 'Crăciunul', '12-26': 'A doua zi de Crăciun',
}

export function legalHolidayName(ymd: string): string | null {
  const parts = partsFromYmd(ymd)
  if (!parts) return null
  const fixed = FIXED_HOLIDAYS[`${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`]
  if (fixed) return fixed
  const easter = orthodoxEaster(parts.year)
  const movable: Record<string, string> = {
    [addCalendarDays(easter, -2)]: 'Vinerea Mare',
    [easter]: 'Prima zi de Paști',
    [addCalendarDays(easter, 1)]: 'A doua zi de Paști',
    [addCalendarDays(easter, 49)]: 'Prima zi de Rusalii',
    [addCalendarDays(easter, 50)]: 'A doua zi de Rusalii',
  }
  return movable[ymd] ?? null
}

export function nonWorkingDayInfo(ymd: string) {
  const parts = partsFromYmd(ymd)
  if (!parts) throw new Error('Invalid date-only value')
  const weekday = new Date(toUtcEpoch(parts)).getUTCDay()
  const holiday = legalHolidayName(ymd)
  if (holiday) return { nonWorking: true as const, kind: 'holiday' as const, reason: holiday }
  if (weekday === 6) return { nonWorking: true as const, kind: 'weekend' as const, reason: 'sâmbătă' }
  if (weekday === 0) return { nonWorking: true as const, kind: 'weekend' as const, reason: 'duminică' }
  return { nonWorking: false as const, kind: null, reason: null }
}

export function previousWorkingDay(ymd: string): string {
  let candidate = ymd
  do candidate = addCalendarDays(candidate, -1)
  while (nonWorkingDayInfo(candidate).nonWorking)
  return candidate
}

export interface OperationalMilestone {
  day: 20 | 21 | 22
  date: string
  operationalDate: string
  nonWorkingReason: string
  dueToday: boolean
}

export function operationalMilestones(depositYmd: string, todayYmd = bucharestToday()): OperationalMilestone[] {
  const milestones = ([20, 21, 22] as const).map((day) => ({ day, date: addCalendarDays(depositYmd, day - 1) }))
  return milestones.flatMap(({ day, date }) => {
    const info = nonWorkingDayInfo(date)
    if (!info.nonWorking) return []
    const operationalDate = previousWorkingDay(date)
    return [{ day, date, operationalDate, nonWorkingReason: info.reason, dueToday: operationalDate === todayYmd }]
  })
}

export type QuarantineKind = 'in_quarantine' | 'tomorrow' | 'today' | 'expired'

export function quarantineState(depositYmd: string, todayYmd = bucharestToday()) {
  const day = quarantineDay(depositYmd, todayYmd)
  const expiry = quarantineExpiry(depositYmd)
  if (day >= 22) {
    const expiredDays = day - 21
    return { day, expiry, kind: 'expired' as const, label: `Expirată de ${expiredDays} ${expiredDays === 1 ? 'zi' : 'zile'}` }
  }
  if (day === 21) return { day, expiry, kind: 'today' as const, label: 'Expiră astăzi' }
  if (day === 20) return { day, expiry, kind: 'tomorrow' as const, label: 'Expiră mâine' }
  return { day, expiry, kind: 'in_quarantine' as const, label: 'În carantină' }
}

export function isFutureDate(ymd: string, todayYmd = bucharestToday()) {
  return calendarDayDifference(todayYmd, ymd) > 0
}
