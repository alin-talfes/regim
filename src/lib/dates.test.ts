import { describe, expect, it } from 'vitest'
import { addCalendarDays, alertState, formatYmd, isAutoArchived, legalHolidayName, maskDateInput, nonWorkingDayInfo, operationalMilestones, parseDisplayDate, previousWorkingDay, provisionalRegimeDate, quarantineDay, quarantineExpiry, quarantineState } from './dates'

describe('quarantine business rule', () => {
  const deposit = '2026-09-01'
  it('counts deposit day as day 1', () => expect(quarantineDay(deposit, '2026-09-01')).toBe(1))
  it('maps mandatory example days', () => {
    expect(quarantineDay(deposit, '2026-09-19')).toBe(19)
    expect(quarantineDay(deposit, '2026-09-20')).toBe(20)
    expect(quarantineDay(deposit, '2026-09-21')).toBe(21)
    expect(quarantineDay(deposit, '2026-09-22')).toBe(22)
  })
  it('keeps day 21 at deposit + 20 calendar days', () => expect(quarantineExpiry(deposit)).toBe('2026-09-21'))
  it('applies provisional regime on day 22, deposit + 21 calendar days', () => expect(provisionalRegimeDate(deposit)).toBe('2026-09-22'))
  it('labels status correctly', () => {
    expect(quarantineState(deposit, '2026-09-20').label).toBe('Expiră mâine')
    expect(quarantineState(deposit, '2026-09-21').label).toBe('Expiră astăzi')
    expect(quarantineState(deposit, '2026-09-22').label).toBe('Aplicare regim astăzi')
  })
  it('classifies alert stages exactly on days 20, 21, 22, 23-30 and archives from day 31', () => {
    expect(alertState(deposit, '2026-09-20')).toEqual({ day: 20, kind: 'tomorrow', label: 'Expiră mâine' })
    expect(alertState(deposit, '2026-09-21')).toEqual({ day: 21, kind: 'today', label: 'Expiră astăzi' })
    expect(alertState(deposit, '2026-09-22')).toEqual({ day: 22, kind: 'provisional_today', label: 'Aplicare regim astăzi' })
    expect(alertState(deposit, '2026-09-23')).toEqual({ day: 23, kind: 'expired', label: 'Expirat' })
    expect(alertState(deposit, '2026-09-30')).toEqual({ day: 30, kind: 'expired', label: 'Expirat' })
    expect(alertState(deposit, '2026-10-01')).toEqual({ day: 31, kind: 'archived', label: 'Arhivat' })
    expect(alertState(deposit, '2026-09-19')).toEqual({ day: 19, kind: 'none', label: '' })
  })
  it('auto-archives exactly from day 31', () => {
    expect(isAutoArchived(deposit, '2026-09-30')).toBe(false)
    expect(isAutoArchived(deposit, '2026-10-01')).toBe(true)
    expect(isAutoArchived(deposit, '2026-10-15')).toBe(true)
  })
})

describe('non-working operational alerts', () => {
  it('detects weekend and moves alerts to previous working day', () => {
    const milestones = operationalMilestones('2026-08-23', '2026-09-11')
    expect(milestones).toEqual([
      { day: 21, date: '2026-09-12', operationalDate: '2026-09-11', nonWorkingReason: 'sâmbătă', dueToday: true },
      { day: 22, date: '2026-09-13', operationalDate: '2026-09-11', nonWorkingReason: 'duminică', dueToday: true },
    ])
  })

  it('detects fixed Romanian legal holidays', () => {
    expect(legalHolidayName('2026-12-25')).toBe('Crăciunul')
    expect(nonWorkingDayInfo('2026-12-25').nonWorking).toBe(true)
    expect(previousWorkingDay('2026-12-25')).toBe('2026-12-24')
  })

  it('detects Orthodox movable legal holidays', () => {
    expect(legalHolidayName('2026-04-10')).toBe('Vinerea Mare')
    expect(legalHolidayName('2026-04-12')).toBe('Prima zi de Paști')
    expect(legalHolidayName('2026-04-13')).toBe('A doua zi de Paști')
    expect(legalHolidayName('2026-05-31')).toBe('Prima zi de Rusalii')
    expect(legalHolidayName('2026-06-01')).toBe('Ziua Copilului')
  })

  it('moves Christmas weekend milestones to the last working day', () => {
    const milestones = operationalMilestones('2026-12-05', '2026-12-24')
    expect(milestones.find((m) => m.day === 21)?.operationalDate).toBe('2026-12-24')
    expect(milestones.find((m) => m.day === 22)?.operationalDate).toBe('2026-12-24')
  })
})

describe('calendar edges', () => {
  it('crosses month end', () => expect(addCalendarDays('2026-01-20', 20)).toBe('2026-02-09'))
  it('handles leap February', () => expect(addCalendarDays('2028-02-10', 20)).toBe('2028-03-01'))
  it('handles non-leap February', () => expect(addCalendarDays('2027-02-10', 20)).toBe('2027-03-02'))
  it('crosses year end', () => expect(addCalendarDays('2026-12-20', 20)).toBe('2027-01-09'))
  it('calculates day 22 across month end', () => expect(provisionalRegimeDate('2026-01-20')).toBe('2026-02-10'))
  it('calculates day 22 across leap February', () => expect(provisionalRegimeDate('2028-02-10')).toBe('2028-03-02'))
  it('calculates day 22 across year end', () => expect(provisionalRegimeDate('2026-12-20')).toBe('2027-01-10'))
})

describe('DD.MM.YYYY parser and mask', () => {
  it('masks 01092026', () => expect(maskDateInput('01092026')).toBe('01.09.2026'))
  it('masks partial input', () => expect(maskDateInput('0109')).toBe('01.09'))
  it('rejects 31.02.2026', () => expect(parseDisplayDate('31.02.2026')).toBeNull())
  it('accepts 29.02.2028', () => expect(parseDisplayDate('29.02.2028')).toBe('2028-02-29'))
  it('rejects 29.02.2027', () => expect(parseDisplayDate('29.02.2027')).toBeNull())
  it('formats YMD explicitly', () => expect(formatYmd('2026-09-07')).toBe('07.09.2026'))
})
