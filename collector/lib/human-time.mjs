// Human time per task, derived from human.start / human.stop / human.adjust events.
//
// Human hours are the denominator of the efficiency score, so they are kept as
// raw facts: one timer at a time (a person does one thing at once), each period
// with its activity, and corrections as separate adjustments that never replace
// what was recorded.

export const ACTIVITIES = ['spec', 'review', 'fix', 'acceptance', 'other'];
export const LONG_SESSION_MINUTES = 8 * 60;

const minutesBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 60000;

/**
 * @returns {{ open: { task_id: string, activity: string, since: string } | null,
 *   tasks: Map<string, { minutes: number, by_activity: Record<string, number>, periods: object[], adjustments: object[], flags: Set<string> }> }}
 */
export function deriveHumanTime(events) {
  const tasks = new Map();
  let open = null;
  const get = (id) => {
    if (!tasks.has(id)) tasks.set(id, { minutes: 0, by_activity: {}, periods: [], adjustments: [], flags: new Set() });
    return tasks.get(id);
  };
  const add = (rec, activity, minutes) => {
    rec.minutes += minutes;
    rec.by_activity[activity] = (rec.by_activity[activity] ?? 0) + minutes;
  };

  for (const e of events) {
    if (!e.task_id) continue;
    const d = e.data ?? {};
    if (e.event === 'human.start') {
      if (open) get(open.task_id).flags.add('overlapping_human_timer'); // cannot happen through the CLI
      open = { task_id: e.task_id, activity: d.activity ?? 'other', since: e.ts };
    } else if (e.event === 'human.stop') {
      if (!open || open.task_id !== e.task_id) {
        get(e.task_id).flags.add('unpaired_human_stop');
        continue;
      }
      const rec = get(open.task_id);
      let minutes = minutesBetween(open.since, e.ts);
      if (minutes < 0) {
        rec.flags.add('clock_went_back'); // the clock changed between start and stop
        minutes = 0;
      }
      rec.periods.push({ from: open.since, to: e.ts, activity: open.activity, minutes, auto: d.auto === true });
      add(rec, open.activity, minutes);
      if (minutes > LONG_SESSION_MINUTES) rec.flags.add('long_human_session');
      if (d.auto === true) rec.flags.add('human_timer_auto_stopped');
      open = null;
    } else if (e.event === 'human.adjust') {
      const rec = get(e.task_id);
      const activity = d.activity ?? 'other';
      rec.adjustments.push({ ts: e.ts, minutes: d.minutes, activity, reason: d.reason });
      add(rec, activity, d.minutes);
    }
  }
  return { open, tasks };
}
