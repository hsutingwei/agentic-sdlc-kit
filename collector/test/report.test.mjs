import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSandbox, runAsdk } from '../../test/helpers/sandbox.mjs';
import { appendEvent } from '../lib/store.mjs';
import { buildRows, COLUMNS, toCsv, toMarkdown } from '../lib/report.mjs';

const ev = (ts, event, task_id, extra = {}) => ({ schema_version: 1, ts, source: 'cli', event, task_id, project_id: 'demo-api', ...extra });

const EVENTS = [
  ev('2026-11-02T01:00:00.000Z', 'task.start', 'DEMO-001', { data: { type: 'feature', risk: 'low', title: 'Due dates, "overdue" filter', estimate_hours: 6 } }),
  ev('2026-11-02T01:05:00.000Z', 'SessionStart', 'DEMO-001', { source: 'hook', session_id: 's-1' }),
  ev('2026-11-02T01:06:00.000Z', 'SubagentStart', 'DEMO-001', { source: 'hook', session_id: 's-1', agent: { id: 'a-1', type: 'implementer' } }),
  ev('2026-11-02T02:00:00.000Z', 'gate.run', 'DEMO-001', { source: 'gate', data: { gate: 'G1', result: 'fail' } }),
  ev('2026-11-02T02:00:00.000Z', 'task.verify', 'DEMO-001', { source: 'gate', data: { check: 'unit', result: 'fail', executor: 'script' } }),
  ev('2026-11-02T02:30:00.000Z', 'gate.run', 'DEMO-001', { source: 'gate', data: { gate: 'G1', result: 'pass' } }),
  ev('2026-11-02T02:30:00.000Z', 'task.verify', 'DEMO-001', { source: 'gate', data: { check: 'unit', result: 'pass', executor: 'script' } }),
  ev('2026-11-02T03:00:00.000Z', 'human.start', 'DEMO-001', { data: { activity: 'acceptance' } }),
  ev('2026-11-02T03:20:00.000Z', 'human.stop', 'DEMO-001'),
  ev('2026-11-02T03:25:00.000Z', 'human.adjust', 'DEMO-001', { data: { minutes: 10, activity: 'spec', reason: 'brief written before timing' } }),
  ev('2026-11-02T03:30:00.000Z', 'task.end', 'DEMO-001', { data: { outcome: 'accepted', completed_by: 'ai' } }),
  ev('2026-11-02T04:00:00.000Z', 'task.start', 'DEMO-002', { data: { type: 'docs', risk: 'low' } }),
  ev('2026-11-02T04:10:00.000Z', 'task.verify', 'DEMO-009', { data: { check: 'unit', result: 'pass', executor: 'script' } }),
];

test('rows carry measured numbers, empty unmeasured ones, and the reasons', () => {
  const [done, open, orphan] = buildRows(EVENTS);
  assert.equal(done.task_id, 'DEMO-001');
  assert.equal(done.lead_time_h, 2.5);
  assert.equal(done.estimate_h, 6);
  assert.equal(done.human_h, 0.5);
  assert.equal(done.efficiency, null);
  assert.equal(done.verifications, 2);
  assert.equal(done.first_pass, false);
  assert.equal(done.gate_runs, 2);
  assert.equal(done.sessions, 1);
  assert.equal(done.subagents, 1);
  assert.equal(done.data_quality, 'Complete');
  assert.deepEqual(done.flags, []);

  assert.deepEqual(open.flags, ['no_estimate', 'no_human_time', 'no_verification', 'open_task']);
  assert.equal(open.lead_time_h, null);
  assert.equal(open.first_pass, null);

  assert.equal(orphan.task_id, 'DEMO-009');
  assert.equal(orphan.data_quality, 'Missing');
  assert.deepEqual(orphan.flags, ['no_task_start']);
});

test('CSV has a BOM, a fixed header and escaped cells', () => {
  const csv = toCsv(buildRows(EVENTS));
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], COLUMNS.join(','));
  assert.match(lines[1], /^DEMO-001,demo-api,"Due dates, ""overdue"" filter",feature,low,ended,accepted,ai,/);
  assert.match(lines[2], /,no_estimate;no_human_time;no_verification;open_task$/);
});

test('summary.md explains every flag it uses', () => {
  const text = toMarkdown(buildRows(EVENTS), { generatedAt: '2026-11-02T05:00:00.000Z', invalidLines: 2 });
  assert.match(text, /\| DEMO-001 \| demo-api \| accepted \| 2\.5 \| 6 \| 0\.5 \| – \| 2 \| no \| Complete \|/);
  for (const flag of ['no_human_time', 'open_task', 'no_task_start']) assert.match(text, new RegExp(`\`${flag}\`: `));
  assert.match(text, /2 event line\(s\) could not be read/);
});

test('asdk report writes both files', (t) => {
  const sb = createSandbox(t, 'report');
  for (const e of EVENTS.slice(0, 8)) appendEvent(sb.env, e);
  const r = runAsdk(sb, ['report', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const { files, rows } = JSON.parse(r.stdout);
  assert.equal(rows.length, 1);
  assert.match(readFileSync(files.csv, 'utf8'), /DEMO-001/);
  assert.match(readFileSync(files.summary, 'utf8'), /# Task scorecard/);
});
