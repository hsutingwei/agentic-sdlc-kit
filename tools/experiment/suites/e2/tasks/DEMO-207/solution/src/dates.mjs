// Calendar dates as YYYY-MM-DD strings, always in UTC.

const SHAPE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isDate(value) {
  if (typeof value !== 'string' || !SHAPE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Today's date in UTC. */
export const today = (now = new Date()) => now.toISOString().slice(0, 10);

/** The date `days` after `date` (before it, when negative). */
export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The day of the month of a date, as a number. */
export const dayOf = (date) => Number(date.slice(8));

/**
 * The date in the month after `date` with the day `day`, or the last day of that
 * month when it has no such day: monthLater('2026-01-31', 31) is '2026-02-28'.
 */
export function monthLater(date, day) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)); // 1 to 12: as an index from 0, the month after
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}
