import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox, runAsdk } from '../../test/helpers/sandbox.mjs';
import { changePlan, deriveQuota, normalizeWindows, quotaState, recordSnapshot } from '../lib/quota.mjs';
import { readEvents } from '../lib/store.mjs';

const at = (iso) => new Date(iso);

test('a snapshot keeps percentages, reset times and the plan, nothing else', (t) => {
  const sb = createSandbox(t, 'quota-snap');
  recordSnapshot(sb.env, {
    windows: [
      { name: 'five_hour', used_pct: 41.97, resets_at: '2026-11-24T18:00:00Z', secret: 'dropped' },
      { name: 'seven_day', used_pct: 63 },
    ],
    plan: 'max-5x',
    now: at('2026-11-24T10:00:00Z'),
  });
  const [e] = readEvents(sb.env).events;
  assert.deepEqual(e.data, { source: 'manual', plan: 'max-5x', five_hour_pct: 42, five_hour_resets_at: '2026-11-24T18:00:00.000Z', seven_day_pct: 63 });
  const q = quotaState(sb.env);
  assert.deepEqual(q.windows.five_hour, { used_pct: 42, resets_at: '2026-11-24T18:00:00.000Z', recorded_at: '2026-11-24T10:00:00.000Z', source: 'manual' });
  assert.deepEqual(q.snapshot_plan, { plan: 'max-5x', seen_at: '2026-11-24T10:00:00.000Z' });
});

test('window input is validated', () => {
  assert.throws(() => normalizeWindows([{ name: 'Five Hour', used_pct: 1 }]), /window name/);
  assert.throws(() => normalizeWindows([{ name: 'seven_day', used_pct: -1 }]), /from 0 to 1000/);
  assert.throws(() => normalizeWindows([{ name: 'seven_day', used_pct: 'a lot' }]), /from 0 to 1000/);
  assert.throws(() => normalizeWindows([{ name: 'seven_day', used_pct: 1 }, { name: 'seven_day', used_pct: 2 }]), /twice/);
  assert.throws(() => normalizeWindows([{ name: 'seven_day', used_pct: 1, resets_at: 'tomorrow' }]), /not a valid time/);
  assert.throws(() => normalizeWindows(Array.from({ length: 9 }, (_, i) => ({ name: `w${i}`, used_pct: 1 }))), /at most 8/);
  assert.deepEqual(normalizeWindows([{ name: 'weekly_custom', used_pct: 5 }]), [{ name: 'weekly_custom', used_pct: 5 }]);
});

test('plan changes: backdating allowed, but not before the previous one and not into the future', (t) => {
  const sb = createSandbox(t, 'quota-plan');
  const now = at('2026-11-24T10:00:00Z');
  changePlan(sb.env, { plan: 'max-20x', at: '2026-11-01T00:00:00Z', now });
  changePlan(sb.env, { plan: 'max-5x', at: '2026-11-20T00:00:00Z', now });
  assert.throws(() => changePlan(sb.env, { plan: 'pro', at: '2026-11-19T00:00:00Z', now }), /cannot start earlier/);
  assert.throws(() => changePlan(sb.env, { plan: 'pro', at: '2026-11-25T00:00:00Z', now }), /future/);
  assert.throws(() => changePlan(sb.env, { plan: 'Pro Plan', now }), /lowercase/);
  changePlan(sb.env, { plan: 'pro', now });

  const q = quotaState(sb.env);
  assert.deepEqual(q.plans.map((p) => [p.plan, p.effective_at]), [
    ['max-20x', '2026-11-01T00:00:00.000Z'],
    ['max-5x', '2026-11-20T00:00:00.000Z'],
    ['pro', '2026-11-24T10:00:00.000Z'],
  ]);
  assert.equal(q.plan.plan, 'pro');
  // The record time stays the time of writing: history is appended, never rewritten.
  assert.ok(readEvents(sb.env).events.every((e) => e.ts === now.toISOString()));
});

test('the latest snapshot of each window wins', () => {
  const ev = (ts, data) => ({ schema_version: 1, ts, source: 'cli', event: 'quota.snapshot', data: { source: 'manual', ...data } });
  const q = deriveQuota([ev('2026-11-24T09:00:00.000Z', { seven_day_pct: 10, five_hour_pct: 3 }), ev('2026-11-24T10:00:00.000Z', { seven_day_pct: 12 })]);
  assert.equal(q.windows.seven_day.used_pct, 12);
  assert.equal(q.windows.five_hour.used_pct, 3);
  assert.equal(q.plan, null);
});

test('asdk quota snapshot from flags, JSON and stream-json, then status', (t) => {
  const sb = createSandbox(t, 'quota-cli');
  let r = runAsdk(sb, ['quota', 'snapshot', '--window', 'five_hour=42@2099-01-01T00:00:00Z', '--window', 'seven_day=63%', '--plan', 'max-5x']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /five_hour 42%, seven_day 63%/);

  r = runAsdk(sb, ['quota', 'snapshot', '--stdin'], { input: JSON.stringify({ plan: 'max-5x', windows: [{ name: 'seven_day_opus', used_pct: 30, note: 'dropped' }] }) });
  assert.equal(r.status, 0, r.stderr);
  const stream = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { seven_day: { utilization: 0.7, resetsAt: 4070908800, status: 'allowed' } } } }),
  ].join('\n');
  r = runAsdk(sb, ['quota', 'snapshot', '--stdin'], { input: stream });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\(stream-json\).*seven_day 70%/);

  assert.equal(runAsdk(sb, ['quota', 'plan-change', '--plan', 'max-5x']).status, 0);
  r = runAsdk(sb, ['quota', 'status']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^plan: max-5x \(from /m);
  assert.match(r.stdout, /^five_hour\t42%/m);
  assert.match(r.stdout, /^seven_day\t70%\trecorded \d+ min ago \(stream-json\), resets 2099-01-01/m);
  assert.match(r.stdout, /^seven_day_opus\t30%/m);

  assert.equal(runAsdk(sb, ['quota', 'snapshot']).status, 2);
  assert.equal(runAsdk(sb, ['quota', 'snapshot', '--window', 'seven_day=lots']).status, 2);
  assert.equal(runAsdk(sb, ['quota', 'snapshot', '--stdin'], { input: 'not json' }).status, 2);
  assert.equal(runAsdk(sb, ['quota', 'plan-change', '--plan', 'pro', '--at', '2020-01-01T00:00:00Z']).status, 1);
});
