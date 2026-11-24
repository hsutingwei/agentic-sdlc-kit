// AI working time from hook events.
//
// A turn runs from UserPromptSubmit to Stop of the main session; a sub-agent runs
// from SubagentStart to SubagentStop (paired by agent id). Sub-agents start in the
// background by default (docs/spike, finding 6), so a turn can end while one still
// works: both kinds of interval count, and overlapping time counts once.
//
// For a task, the intervals of the sessions that recorded its events are cut to
// the task's window (start to end, or to "now" while it is open): a turn that
// crosses the boundary is clipped, not dropped.

const ms = (iso) => Date.parse(iso);

/**
 * Intervals per session.
 * @returns {Map<string, { intervals: [number, number][], unpaired: number }>}
 */
export function sessionIntervals(events) {
  const sessions = new Map();
  const get = (id) => {
    if (!sessions.has(id)) sessions.set(id, { intervals: [], unpaired: 0, turn: null, agents: new Map(), last: null });
    return sessions.get(id);
  };
  for (const e of events) {
    if (e.source !== 'hook' || !e.session_id) continue;
    const s = get(e.session_id);
    const t = ms(e.ts);
    s.last = t;
    if (e.event === 'UserPromptSubmit' && !e.agent) {
      if (s.turn !== null) {
        s.unpaired++; // a new prompt before the previous turn stopped
        s.intervals.push([s.turn, t]);
      }
      s.turn = t;
    } else if (e.event === 'Stop' && !e.agent) {
      if (s.turn !== null) s.intervals.push([s.turn, t]);
      s.turn = null;
    } else if (e.event === 'SubagentStart' && e.agent?.id) {
      s.agents.set(e.agent.id, t);
    } else if (e.event === 'SubagentStop' && e.agent?.id) {
      const from = s.agents.get(e.agent.id);
      if (from !== undefined) {
        s.intervals.push([from, t]);
        s.agents.delete(e.agent.id);
      }
    }
  }
  const out = new Map();
  for (const [id, s] of sessions) {
    // Whatever is still open ends at the session's last event, and is counted as unpaired.
    if (s.turn !== null) {
      s.unpaired++;
      s.intervals.push([s.turn, s.last]);
    }
    for (const from of s.agents.values()) {
      s.unpaired++;
      s.intervals.push([from, s.last]);
    }
    out.set(id, { intervals: s.intervals.filter(([a, b]) => b > a), unpaired: s.unpaired });
  }
  return out;
}

/** Sorted, non-overlapping union of intervals. */
export function union(intervals) {
  const sorted = [...intervals].sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const [a, b] of sorted) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

const clip = (intervals, from, to) => intervals.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a);

const hours = (intervals) => intervals.reduce((n, [a, b]) => n + (b - a), 0) / 3_600_000;

/**
 * AI time of one task.
 * @param {Map} perSession from sessionIntervals
 * @param {{ sessions: Set<string>, started_at: string, ended_at?: string }} task
 * @returns {{ ai_h: number, ai_ms: number, unpaired: number, concurrent: boolean }} ai_h is rounded; ai_ms is exact
 */
export function taskAiTime(perSession, task, now = Date.now()) {
  const from = ms(task.started_at);
  const to = task.ended_at ? ms(task.ended_at) : now;
  const clipped = [];
  let unpaired = 0;
  for (const id of task.sessions) {
    const s = perSession.get(id);
    if (!s) continue;
    const mine = clip(s.intervals, from, to);
    if (mine.length > 0) {
      clipped.push({ id, intervals: union(mine) });
      unpaired += s.unpaired;
    }
  }
  // Two sessions working at the same moment on one task.
  let concurrent = false;
  for (let i = 0; i < clipped.length && !concurrent; i++) {
    for (let j = i + 1; j < clipped.length && !concurrent; j++) {
      concurrent = clipped[i].intervals.some(([a, b]) => clipped[j].intervals.some(([c, d]) => a < d && c < b));
    }
  }
  const all = union(clipped.flatMap((c) => c.intervals));
  return { ai_h: Math.round(hours(all) * 100) / 100, ai_ms: all.reduce((n, [a, b]) => n + (b - a), 0), unpaired, concurrent };
}

/** Hours of `intervals` ([fromIso, toIso?]) inside the task window; an open interval runs to the window's end. */
export function hoursWithin(periods, task, now = Date.now()) {
  const from = ms(task.started_at);
  const to = task.ended_at ? ms(task.ended_at) : now;
  const iv = periods.map((p) => [ms(p.from), p.to ? ms(p.to) : to]);
  return Math.round(hours(union(clip(iv, from, to))) * 100) / 100;
}
