import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, runAsdk } from '../../test/helpers/sandbox.mjs';
import { dataPath } from '../lib/paths.mjs';
import { buildReport, COLUMNS, maskText, OUTSIDE_TASKS, privacyMasks, toCsv, toMarkdown } from '../lib/report.mjs';
import { appendEvent } from '../lib/store.mjs';

const T = (min) => new Date(Date.UTC(2026, 10, 2, 9, 0) + min * 60000).toISOString();
const ev = (min, event, task_id, extra = {}) => ({ schema_version: 1, ts: T(min), source: 'cli', event, ...(task_id ? { task_id } : {}), project_id: 'demo-api', ...extra });
const hook = (min, event, session, task_id, extra = {}) => ev(min, event, task_id, { source: 'hook', session_id: session, ...extra });
const msg = (min, model, output, agent_id) => ({
  id: `${String(min).padStart(4, '0')}${model.length}`.padEnd(20, 'a'),
  ts: T(min),
  model,
  ...(agent_id ? { agent_id } : {}),
  input_tokens: 10,
  output_tokens: output,
  cache_write_tokens: 100,
  cache_read_tokens: 1000,
});
const usage = (session, messages, extra = {}) => ({ schema_version: 1, tool: 'claude-code', session_id: session, tool_versions: [], sources: [{ kind: 'main', lines: 1, bad_lines: 0, unparsed: 0 }], messages, tool_results: { count: 0, bytes: 0 }, ...extra });

// DEMO-001: accepted; first check failed; timed; one session with usage. DEMO-003 later fixes it.
// DEMO-002: still open. DEMO-004: accepted, but its session was never harvested. DEMO-009: never started.
const EVENTS = [
  ev(0, 'task.start', 'DEMO-001', { data: { type: 'feature', risk: 'low', title: 'Due dates, "overdue" filter', estimate_hours: 6 } }),
  ev(0, 'human.start', 'DEMO-001', { data: { activity: 'spec' } }),
  ev(10, 'human.stop', 'DEMO-001'),
  hook(5, 'UserPromptSubmit', 's-1', 'DEMO-001'),
  hook(6, 'SubagentStart', 's-1', 'DEMO-001', { agent: { id: 'a-1', type: 'implementer' } }),
  hook(8, 'Stop', 's-1', 'DEMO-001'),
  hook(40, 'SubagentStop', 's-1', 'DEMO-001', { agent: { id: 'a-1', type: 'implementer' } }),
  ev(60, 'task.verify', 'DEMO-001', { source: 'gate', data: { check: 'unit', result: 'fail', executor: 'script', gate: 'G1' } }),
  ev(90, 'task.verify', 'DEMO-001', { source: 'gate', data: { check: 'unit', result: 'pass', executor: 'script', gate: 'G1' } }),
  ev(100, 'task.block', 'DEMO-001', { data: { reason: 'review', waiting_on: 'human' } }),
  ev(130, 'task.resume', 'DEMO-001', { data: { reason: 'reviewed' } }),
  ev(130, 'human.start', 'DEMO-001', { data: { activity: 'review' } }),
  ev(150, 'human.stop', 'DEMO-001'),
  ev(155, 'task.verify', 'DEMO-001', { data: { check: 'acceptance', result: 'pass', executor: 'human' } }),
  ev(160, 'task.end', 'DEMO-001', { data: { outcome: 'accepted', completed_by: 'ai' } }),
  ev(170, 'task.start', 'DEMO-002', { data: { type: 'docs', risk: 'low' } }),
  ev(180, 'task.start', 'DEMO-003', { data: { type: 'bugfix', risk: 'low', estimate_hours: 1, fixes: 'DEMO-001' } }),
  ev(185, 'task.start', 'DEMO-004', { data: { type: 'feature', risk: 'low', estimate_hours: 2 } }),
  hook(186, 'UserPromptSubmit', 's-4', 'DEMO-004'),
  hook(190, 'Stop', 's-4', 'DEMO-004'),
  ev(191, 'human.adjust', 'DEMO-004', { data: { minutes: 30, activity: 'review', reason: 'reviewed before timing' } }),
  ev(192, 'task.verify', 'DEMO-004', { data: { check: 'unit', result: 'pass', executor: 'script' } }),
  ev(195, 'task.end', 'DEMO-004', { data: { outcome: 'accepted', completed_by: 'ai' } }),
  hook(200, 'UserPromptSubmit', 's-x', undefined, { project_id: null }),
  ev(210, 'task.verify', 'DEMO-009', { data: { check: 'unit', result: 'pass', executor: 'script' } }),
];

const USAGE = {
  's-1': usage('s-1', [msg(5, 'claude-opus-5-5', 300), msg(20, 'claude-sonnet-5-5', 700, 'a-1'), msg(170, 'claude-opus-5-5', 50)]),
  's-x': usage('s-x', [msg(200, 'claude-opus-5-5', 250)]),
};
const report = () => buildReport({ events: EVENTS, usageOf: (id) => USAGE[id] ?? null, now: new Date(T(300)) });
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.task_id, r]));

test('a complete task: times, tokens inside its window, quality and score', () => {
  const r = byId(report().rows)['DEMO-001'];
  assert.equal(r.lead_time_h, 2.67);
  assert.equal(r.ai_h, Math.round((35 / 60) * 100) / 100); // 5-40: the turn and the background sub-agent
  assert.equal(r.human_h, 0.5);
  assert.equal(r.human_spec_h, 0.17);
  assert.equal(r.human_review_h, 0.33);
  assert.equal(r.waiting_human_h, 0.5);
  assert.equal(r.blocked_h, 0.5);
  assert.equal(r.verifications, 3);
  assert.equal(r.first_pass, false);
  assert.equal(r.escaped_defects, 1);
  assert.equal(r.output_tokens, 1000); // the response at minute 170 is after the task ended
  assert.equal(r.subagents, 1);
  assert.equal(r.efficiency_raw, 12);
  assert.equal(r.quality, 0.6); // first check failed (-0.1), escaped defect (-0.3)
  assert.equal(r.efficiency, 7.2);
  assert.equal(r.data_quality, 'Complete');
  assert.deepEqual(r.flags, []);
});

test('grades: open and never-started tasks are Missing, doubtful ones Partial', () => {
  const rows = byId(report().rows);
  assert.equal(rows['DEMO-002'].data_quality, 'Missing');
  assert.deepEqual(rows['DEMO-002'].flags, ['no_estimate', 'no_human_time', 'no_verification', 'open_task']);
  assert.equal(rows['DEMO-002'].efficiency, null);
  assert.equal(rows['DEMO-009'].data_quality, 'Missing');
  assert.deepEqual(rows['DEMO-009'].flags, ['no_task_start']);
  assert.equal(rows['DEMO-004'].data_quality, 'Partial');
  assert.deepEqual(rows['DEMO-004'].flags, ['usage_not_harvested']);
  assert.equal(rows['DEMO-004'].efficiency, 4); // shown, but not in the headline
});

test('headline, coverage, verifications and usage tables', () => {
  const r = report();
  assert.deepEqual(r.aggregate, { tasks: 1, accepted: 1, estimate_h: 3.6, human_h: 0.5, efficiency: 7.2 });
  assert.deepEqual(r.coverage, { sessions: 3, not_harvested: 1, output_tokens: 1300, in_tasks: 1000, share_in_tasks: 0.77 });
  assert.equal(r.verifications.length, 4); // DEMO-009 was never started: its check is not a task check
  assert.deepEqual(r.verifications[0], { task_id: 'DEMO-001', ts: T(60), check: 'unit', result: 'fail', executor: 'script', gate: 'G1', sha: null, evidence: null });
  assert.deepEqual(
    r.usageRows.map((u) => [u.task_id, u.model, u.output_tokens]),
    [
      ['DEMO-001', 'claude-opus-5-5', 300],
      ['DEMO-001', 'claude-sonnet-5-5', 700],
      [OUTSIDE_TASKS, 'claude-opus-5-5', 300],
    ],
  );
});

test('CSV and markdown: BOM, escaping, masking and every flag explained', () => {
  const r = report();
  const csv = toCsv(r.rows, COLUMNS, ['overdue']);
  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], COLUMNS.join(','));
  assert.match(lines[1], /^DEMO-001,demo-api,"Due dates, ""\[masked\]"" filter",feature,/);
  const text = toMarkdown(r, { generatedAt: T(300), invalidLines: 2 });
  assert.match(text, /5 task\(s\): 1 Complete, 1 Partial, 3 Missing/);
  assert.match(text, /\*\*7\.2×\*\* over 1 Complete task\(s\)/);
  assert.match(text, /\| DEMO-001 \| demo-api \| accepted \| 2\.67 \| 0\.58 \| 0\.5 \| 0\.5 \| 6 \| 12 × 0\.6 = 7\.2 \| 3 \| no \| 0 \| 1,000 \| Complete \|/);
  assert.match(text, /spec 0\.17 h · review 0\.83 h/);
  assert.match(text, /Task coverage: 77% of 1,300 output tokens were spent inside tasks; 1 of 3 session\(s\) not harvested/);
  for (const flag of ['no_task_start', 'open_task', 'usage_not_harvested']) assert.match(text, new RegExp(`\`${flag}\`: `));
  assert.match(text, /2 event line\(s\) could not be read/);
});

test('privacy masks are validated and match case-insensitively', () => {
  assert.deepEqual(privacyMasks({}), []);
  assert.throws(() => privacyMasks({ privacy: { mask: ['ok', ''] } }), /non-empty strings/);
  assert.equal(maskText('Built for ACME Corp (acme corp)', ['acme corp']), 'Built for [masked] ([masked])');
  assert.equal(maskText('a.b', ['.']), 'a[masked]b');
});

test('asdk report writes four files, applies the configured masks and honours --out', (t) => {
  const sb = createSandbox(t, 'report-cli');
  for (const e of EVENTS) appendEvent(sb.env, e, e.session_id ?? '_manual');
  mkdirSync(dataPath(sb.env, 'usage'), { recursive: true });
  for (const [id, doc] of Object.entries(USAGE)) writeFileSync(dataPath(sb.env, 'usage', `${id}.json`), JSON.stringify(doc));
  writeFileSync(dataPath(sb.env, 'config.json'), JSON.stringify({ schema_version: 1, projects: [], privacy: { mask: ['Due dates'] } }));

  let r = runAsdk(sb, ['report', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const { files, aggregate } = JSON.parse(r.stdout);
  assert.equal(aggregate.efficiency, 7.2);
  for (const f of Object.values(files)) assert.ok(existsSync(f), f);
  assert.match(readFileSync(files.tasks, 'utf8'), /\[masked\]/);
  assert.doesNotMatch(readFileSync(files.tasks, 'utf8'), /Due dates/);
  assert.match(readFileSync(files.usage, 'utf8'), /\(outside tasks\),claude-opus-5-5,2,20,300,/);

  const out = sb.join('報表 輸出');
  r = runAsdk(sb, ['report', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /efficiency 7\.2× over 1 Complete task/);
  assert.ok(existsSync(path.join(out, 'summary.md')));
});
