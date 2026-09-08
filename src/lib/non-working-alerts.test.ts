import { describe, expect, it } from 'vitest'
import { operationalMilestones } from './dates'

describe('non-working operational alert scope', () => {
  it('does not create a non-working alert for day 20', () => {
    const milestones = operationalMilestones('2026-08-24', '2026-09-11')

    expect(milestones).toEqual([
      {
        day: 21,
        date: '2026-09-13',
        operationalDate: '2026-09-11',
        nonWorkingReason: 'duminică',
        dueToday: true,
      },
    ])
  })
})
