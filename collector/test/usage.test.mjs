import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox, runAsdk } from '../../test/helpers/sandbox.mjs';
import { dataPath } from '../lib/paths.mjs';
import { appendEvent, makeEvent } from '../lib/store.mjs';
import { harvestedSessions, readUsage, summarizeUsage } from '../lib/usage.mjs';

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../core/test/fixtures/usage.valid.json', import.meta.url)), 'utf8'));

function writeUsage(sb, doc) {
  const file = dataPath(sb.env, 'usage', `${doc.session_id}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(doc));
}

test('totals by model and by agent type, with missing and damaged sessions named', (t) => {
  const sb = createSandbox(t, 'usage-sum');
  writeUsage(sb, FIXTURE);
  writeUsage(sb, { ...FIXTURE, session_id: 'sess-2', sources: [{ kind: 'main', lines: 3, bad_lines: 1, unparsed: 1 }], messages: [FIXTURE.messages[0]] });
  mkdirSync(dataPath(sb.env, 'usage'), { recursive: true });
  writeFileSync(dataPath(sb.env, 'usage', 'sess-bad.json'), '{"schema_version":1');

  assert.deepEqual(harvestedSessions(sb.env), [FIXTURE.session_id, 'sess-2', 'sess-bad'].sort());
  assert.equal(readUsage(sb.env, '../x'), null);
  const s = summarizeUsage(sb.env, [FIXTURE.session_id, 'sess-2', 'sess-bad', 'sess-none']);
  assert.equal(s.sessions, 2);
  assert.deepEqual(s.missing, ['sess-none']);
  assert.deepEqual(s.invalid, ['sess-bad']);
  assert.equal(s.unreadable_records, 2);
  assert.equal(s.total.responses, 3);
  assert.equal(s.total.output_tokens, 451 * 2 + 392);
  assert.equal(s.by_model['claude-sonnet-5-5'].output_tokens, 392);
  assert.equal(s.by_agent_type.implementer.responses, 1);
  assert.equal(s.by_agent_type.main.responses, 2);
  assert.equal(s.tool_results.count, 18);
});

test('asdk usage for a task and for everything harvested', (t) => {
  const sb = createSandbox(t, 'usage-cli');
  writeUsage(sb, FIXTURE);
  appendEvent(sb.env, makeEvent({ source: 'cli', event: 'task.start', task_id: 'DEMO-001', project_id: 'demo-api', data: { type: 'feature', risk: 'low' } }));
  appendEvent(sb.env, makeEvent({ source: 'hook', event: 'Stop', session_id: FIXTURE.session_id, task_id: 'DEMO-001', project_id: 'demo-api' }), FIXTURE.session_id);
  appendEvent(sb.env, makeEvent({ source: 'hook', event: 'Stop', session_id: 'sess-later', task_id: 'DEMO-001', project_id: 'demo-api' }), 'sess-later');

  let r = runAsdk(sb, ['usage', '--task', 'DEMO-001']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^total\t2 resp\tin 16\tout 843\t/m);
  assert.match(r.stdout, /^agent implementer\t1 resp/m);
  assert.match(r.stdout, /^not harvested: sess-later/m);
  r = runAsdk(sb, ['usage', '--json']);
  assert.equal(JSON.parse(r.stdout).sessions, 1);
  assert.equal(runAsdk(sb, ['usage', '--task', 'DEMO-404']).status, 1);
});
