/**
 * Date helpers for compliance schedule test combinations.
 *
 * The backend uses this formula:
 *   targetMonth = periodEndMonth + monthOffset
 *   targetYear  = periodEndYear + floor((targetMonth - 1) / 12)
 *   day         = min(day, lastDayOfMonth(targetYear, targetMonth))
 */

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Mirror the backend computeDateFromOffset logic. */
export function computeDate(
  periodEndMonth: number,
  periodEndYear:  number,
  monthOffset:    number,
  day:            number,
): Date {
  const rawMonth    = periodEndMonth + monthOffset;
  const targetYear  = periodEndYear + Math.floor((rawMonth - 1) / 12);
  const targetMonth = ((rawMonth - 1) % 12) + 1;
  const clampedDay  = Math.min(day, lastDayOfMonth(targetYear, targetMonth));
  return new Date(Date.UTC(targetYear, targetMonth - 1, clampedDay));
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Returns true if the computed date is strictly before today (IST). */
export function isDateInPast(date: Date): boolean {
  const IST_OFFSET_MS = 330 * 60 * 1000;
  const istNow  = new Date(Date.now() + IST_OFFSET_MS);
  const todayMidnight = new Date(Date.UTC(
    istNow.getUTCFullYear(),
    istNow.getUTCMonth(),
    istNow.getUTCDate(),
  ));
  return date < todayMidnight;
}

/**
 * Schedule combinations to exercise all date edge cases.
 * Each entry is a full monthly schedule (12 identical periods for simplicity,
 * only period_index differs).
 */
export interface ScheduleCombo {
  label: string;
  creation_month_offset: number;
  creation_day: number;
  deadline_month_offset: number;
  deadline_day: number;
  expectValid: boolean;
  notes: string;
}

export const SCHEDULE_COMBOS: ScheduleCombo[] = [
  {
    label: 'standard — next month creation',
    creation_month_offset: 1,
    creation_day: 11,
    deadline_month_offset: 1,
    deadline_day: 20,
    expectValid: true,
    notes: 'Normal GSTR-1 style. Both dates in next month.',
  },
  {
    label: 'creation same month as period end',
    creation_month_offset: 0,
    creation_day: 25,
    deadline_month_offset: 1,
    deadline_day: 10,
    expectValid: true,
    notes: 'Case created on the 25th of the period\'s own month.',
  },
  {
    label: 'maximum monthly deadline offset (3 months out)',
    creation_month_offset: 1,
    creation_day: 10,
    deadline_month_offset: 3,
    deadline_day: 30,
    expectValid: true,
    notes: 'Deadline at the upper bound currently allowed by the monthly UI.',
  },
  {
    label: 'day 31 in month with only 30 days (clamps to 30)',
    creation_month_offset: 1,
    creation_day: 31,
    deadline_month_offset: 2,
    deadline_day: 31,
    expectValid: true,
    notes: 'Day 31 is accepted by UI; backend clamps to last day of target month.',
  },
  {
    label: 'Feb 29 target in leap year (period end = Dec of leap year − 1)',
    creation_month_offset: 2,
    creation_day: 29,
    deadline_month_offset: 3,
    deadline_day: 15,
    expectValid: true,
    notes: 'offset 2 from Dec = Feb. In a leap year Feb 29 is valid.',
  },
  {
    label: 'Feb 29 target within max monthly offset (clamps when needed)',
    creation_month_offset: 3,
    creation_day: 29,
    deadline_month_offset: 3,
    deadline_day: 15,
    expectValid: true,
    notes: 'Uses the largest supported monthly offset and relies on backend clamping when February is shorter.',
  },
  {
    label: 'deadline before creation date (invalid)',
    creation_month_offset: 2,
    creation_day: 15,
    deadline_month_offset: 1,
    deadline_day: 20,
    expectValid: false,
    notes: 'Deadline is 1 month after period end; creation is 2 months after. Deadline < creation.',
  },
  {
    label: 'deadline same day as creation (invalid — must be strictly after)',
    creation_month_offset: 1,
    creation_day: 15,
    deadline_month_offset: 1,
    deadline_day: 15,
    expectValid: false,
    notes: 'Deadline equals creation date. Backend schema rejects this.',
  },
  {
    label: 'creation day 1 (first of next month)',
    creation_month_offset: 1,
    creation_day: 1,
    deadline_month_offset: 1,
    deadline_day: 20,
    expectValid: true,
    notes: 'Earliest possible creation in next month.',
  },
  {
    label: 'creation day 28 (safe for all months including Feb)',
    creation_month_offset: 1,
    creation_day: 28,
    deadline_month_offset: 2,
    deadline_day: 15,
    expectValid: true,
    notes: 'Day 28 is always valid regardless of month.',
  },
];

/** Build a full monthly schedule (12 periods) from a single combo. */
export function buildMonthlySchedule(combo: ScheduleCombo) {
  return Array.from({ length: 12 }, (_, i) => ({
    period_index:          i,
    creation_month_offset: combo.creation_month_offset,
    creation_day:          combo.creation_day,
    deadline_month_offset: combo.deadline_month_offset,
    deadline_day:          combo.deadline_day,
  }));
}

/** Build a quarterly schedule (4 periods). Negative offsets allowed. */
export function buildQuarterlySchedule(combo: ScheduleCombo) {
  return Array.from({ length: 4 }, (_, i) => ({
    period_index:          i,
    creation_month_offset: combo.creation_month_offset,
    creation_day:          combo.creation_day,
    deadline_month_offset: combo.deadline_month_offset,
    deadline_day:          combo.deadline_day,
  }));
}
