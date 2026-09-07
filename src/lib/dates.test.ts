import { describe, expect, it } from 'vitest'
import { addCalendarDays, formatYmd, maskDateInput, parseDisplayDate, quarantineDay, quarantineExpiry, quarantineState } from './dates'

describe('quarantine business rule', () => {
  const deposit = '2026-09-01'
  it('counts deposit day as day 1', () => expect(quarantineDay(deposit, '2026-09-01')).toBe(1))
  it('maps mandatory example days', () => {
    expect(quarantineDay(deposit, '2026-09-19')).toBe(19)
    expect(quarantineDay(deposit, '2026-09-20')).toBe(20)
    expect(quarantineDay(deposit, '2026-09-21')).toBe(21)
    expect(quarantineDay(deposit, '2026-09-22')).toBe(22)
  })
  it('expires on deposit + 20 calendar days', () => expect(quarantineExpiry(deposit)).toBe('2026-09-21'))
  it('labels status correctly', () => {
    expect(quarantineState(deposit, '2026-09-20').label).toBe('Expiră mâine')
    expect(quarantineState(deposit, '2026-09-21').label).toBe('Expiră astăzi')
    expect(quarantineState(deposit, '2026-09-22').label).toBe('Expirată de 1 zi')
  })
})

describe('calendar edges', () => {
  it('crosses month end', () => expect(addCalendarDays('2026-01-20', 20)).toBe('2026-02-09'))
  it('handles leap February', () => expect(addCalendarDays('2028-02-10', 20)).toBe('2028-03-01'))
  it('handles non-leap February', () => expect(addCalendarDays('2027-02-10', 20)).toBe('2027-03-02'))
  it('crosses year end', () => expect(addCalendarDays('2026-12-20', 20)).toBe('2027-01-09'))
})

describe('DD.MM.YYYY parser and mask', () => {
  it('masks 01092026', () => expect(maskDateInput('01092026')).toBe('01.09.2026'))
  it('masks partial input', () => expect(maskDateInput('0109')).toBe('01.09'))
  it('rejects 31.02.2026', () => expect(parseDisplayDate('31.02.2026')).toBeNull())
  it('accepts 29.02.2028', () => expect(parseDisplayDate('29.02.2028')).toBe('2028-02-29'))
  it('rejects 29.02.2027', () => expect(parseDisplayDate('29.02.2027')).toBeNull())
  it('formats YMD explicitly', () => expect(formatYmd('2026-09-07')).toBe('07.09.2026'))
})
