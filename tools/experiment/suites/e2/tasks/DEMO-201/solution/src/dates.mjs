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

/** True when `todo` is not done and was due before `day`. An item due on `day` is not overdue. */
export function isOverdue(todo, day) {
  return !todo.done && todo.due_date !== null && todo.due_date < day;
}
