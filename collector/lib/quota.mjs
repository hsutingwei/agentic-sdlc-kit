// Quota snapshots and plan changes.
//
// A snapshot keeps only what the spec allows: per usage window the percentage
// used and when it resets, plus the plan name. A plan change records from when a
// plan applies; it may be backdated, but never before the previous plan change
// and never into the future. Nothing is rewritten: the record time (ts) is when
// it was written, and the time it applies from is kept separately.

import { ruleError, usageError } from '../../core/errors.mjs';
import { withCollectorLock } from './locks.mjs';
import { appendEvent, makeEvent, MANUAL_STREAM, readEvents } from './store.mjs';

export const KNOWN_WINDOWS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];
const WINDOW = /^[a-z][a-z0-9_]{0,23}$/;
const PLAN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_WINDOWS = 8;
const CLOCK_SLACK_MS = 60 * 1000;
export const SNAPSHOT_SOURCES = ['manual', 'json', 'stream-json'];

function checkPlan(plan) {
  if (!PLAN.test(plan ?? '')) throw usageError(`plan "${plan}" must be lowercase letters, digits and -, for example pro, max-5x, team`);
}

function toIso(value, label) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw usageError(`${label} is not a valid time: ${value}`);
  return new Date(ms).toISOString();
}

/** Validates windows [{ name, used_pct, resets_at? }] and returns them normalized, dropping anything else. */
export function normalizeWindows(windows) {
  if (!Array.isArray(windows)) throw usageError('windows must be a list');
  if (windows.length > MAX_WINDOWS) throw usageError(`at most ${MAX_WINDOWS} windows per snapshot`);
  const seen = new Set();
  return windows.map((w) => {
    if (!WINDOW.test(w?.name ?? '')) throw usageError(`window name "${w?.name}" must look like ${KNOWN_WINDOWS.join(', ')}`);
    if (seen.has(w.name)) throw usageError(`window ${w.name} appears twice`);
    seen.add(w.name);
    const pct = Number(w.used_pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 1000) throw usageError(`window ${w.name}: used percentage must be a number from 0 to 1000`);
    const out = { name: w.name, used_pct: Math.round(pct * 10) / 10 };
    if (w.resets_at !== undefined && w.resets_at !== null && w.resets_at !== '') out.resets_at = toIso(w.resets_at, `window ${w.name} reset time`);
    return out;
  });
}

export function recordSnapshot(env, { windows, plan, source = 'manual', now }) {
  if (!SNAPSHOT_SOURCES.includes(source)) throw usageError(`unknown snapshot source ${source}`);
  const list = normalizeWindows(windows ?? []);
  if (plan !== undefined) checkPlan(plan);
  if (list.length === 0 && plan === undefined) throw usageError('a snapshot needs at least one window or a plan');
  const data = { source };
  if (plan !== undefined) data.plan = plan;
  for (const w of list) {
    data[`${w.name}_pct`] = w.used_pct;
    if (w.resets_at) data[`${w.name}_resets_at`] = w.resets_at;
  }
  return appendEvent(env, makeEvent({ source: 'cli', event: 'quota.snapshot', data }, now));
}

/** Folds quota events into the current plan, the plan history and the latest value of each window. */
export function deriveQuota(events) {
  const plans = [];
  const windows = {};
  let snapshotPlan = null;
  for (const e of events) {
    const d = e.data ?? {};
    if (e.event === 'quota.plan-change') plans.push({ plan: d.plan, effective_at: d.effective_at, recorded_at: e.ts });
    if (e.event !== 'quota.snapshot') continue;
    if (d.plan) snapshotPlan = { plan: d.plan, seen_at: e.ts };
    for (const [key, value] of Object.entries(d)) {
      const m = /^(.+)_pct$/.exec(key);
      if (!m) continue;
      windows[m[1]] = { used_pct: value, resets_at: d[`${m[1]}_resets_at`], recorded_at: e.ts, source: d.source };
    }
  }
  plans.sort((a, b) => (a.effective_at < b.effective_at ? -1 : a.effective_at > b.effective_at ? 1 : 0));
  return { plan: plans.at(-1) ?? null, plans, snapshot_plan: snapshotPlan, windows };
}

export function quotaState(env) {
  return deriveQuota(readEvents(env, { streams: [MANUAL_STREAM] }).events);
}

/** Records that `plan` applies from `at` (default now): not before the previous change, not in the future. */
export function changePlan(env, { plan, at, now = new Date() }) {
  checkPlan(plan);
  const effective = at === undefined ? now.toISOString() : toIso(at, '--at');
  if (Date.parse(effective) > now.getTime() + CLOCK_SLACK_MS) throw ruleError('a plan change cannot start in the future');
  return withCollectorLock(env, 'quota', () => {
    const previous = quotaState(env).plan;
    if (previous && effective < previous.effective_at) {
      throw ruleError(`the previous plan change (${previous.plan}) applies from ${previous.effective_at}; a new one cannot start earlier`);
    }
    return appendEvent(env, makeEvent({ source: 'cli', event: 'quota.plan-change', data: { plan, effective_at: effective } }, now));
  });
}
