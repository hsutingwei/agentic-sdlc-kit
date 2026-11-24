import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, runAsdk } from '../../../test/helpers/sandbox.mjs';
import { validateContract } from '../../../core/validate.mjs';
import { appendEvent, makeEvent } from '../../../collector/lib/store.mjs';
import { buildUsage, findTranscripts, harvestSession, usageFile } from '../harvest.mjs';
import { projectsDir } from '../paths.mjs';
import { jsonl, response, SECRET, toolResult } from './transcript-fixtures.mjs';

const SESSION = '8d0f6a52-3b1e-4c7a-9e21-5f4b2c0d9a11';

/** Lays out transcripts the way Claude Code does, under the sandbox's CLAUDE_CONFIG_DIR. */
function writeSession(sb, { project = 'C--work-示範-專案', session = SESSION, main, agents = [] }) {
  const dir = path.join(projectsDir(sb.env), project);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${session}.jsonl`), jsonl(main));
  for (const a of agents) {
    const sub = path.join(dir, session, 'subagents');
    mkdirSync(sub, { recursive: true });
    writeFileSync(path.join(sub, `agent-${a.id}.jsonl`), jsonl(a.records));
    if (a.meta) writeFileSync(path.join(sub, `agent-${a.id}.meta.json`), JSON.stringify(a.meta));
  }
}

const MAIN = () => [
  ...response({ messageId: 'msg_m1', requestId: 'req_m1', copies: 2, usage: { input_tokens: 10, output_tokens: 300, cache_read_input_tokens: 9000 } }),
  toolResult(`${SECRET} file content`),
  ...response({ messageId: 'msg_m2', requestId: 'req_m2', usage: { input_tokens: 3, output_tokens: 153 } }),
];
const AGENT = () => ({
  id: 'a335511527b9d0f06',
  meta: { agentType: 'implementer', model: 'claude-sonnet-5-5', description: SECRET, spawnDepth: 1 },
  records: response({ messageId: 'msg_s1', requestId: 'req_s1', copies: 3, agentId: 'a335511527b9d0f06', model: 'claude-sonnet-5-5', usage: { output_tokens: 392 } }),
});

test('a session and its sub-agent become one valid usage document', (t) => {
  const sb = createSandbox(t, 'harvest-doc');
  writeSession(sb, { main: MAIN(), agents: [AGENT()] });
  const doc = buildUsage(sb.env, SESSION);
  assert.deepEqual(validateContract('usage', doc).errors, []);
  assert.equal(doc.messages.length, 3);
  assert.equal(doc.messages.reduce((n, m) => n + m.output_tokens, 0), 845);
  assert.deepEqual(doc.sources.map((s) => [s.kind, s.agent_type ?? null]), [['main', null], ['subagent', 'implementer']]);
  assert.equal(doc.messages.find((m) => m.model === 'claude-sonnet-5-5').agent_id, 'a335511527b9d0f06');
  assert.equal(doc.tool_results.count, 1);
  const text = JSON.stringify(doc);
  assert.doesNotMatch(text, new RegExp(SECRET));
  assert.doesNotMatch(text, /示範|C--work|projects/);
});

test('harvesting is idempotent, byte for byte, and rebuilds after deletion', (t) => {
  const sb = createSandbox(t, 'harvest-idem');
  writeSession(sb, { main: MAIN(), agents: [AGENT()] });
  assert.equal(harvestSession(sb.env, SESSION).status, 'harvested');
  const file = usageFile(sb.env, SESSION);
  const first = readFileSync(file);
  const mtime = statSync(file).mtimeMs;
  assert.equal(harvestSession(sb.env, SESSION).status, 'unchanged');
  assert.equal(statSync(file).mtimeMs, mtime, 'an unchanged harvest does not rewrite the file');
  rmSync(path.dirname(file), { recursive: true });
  assert.equal(harvestSession(sb.env, SESSION).status, 'harvested');
  assert.ok(readFileSync(file).equals(first));
});

test('a session found in two project folders is counted once', (t) => {
  const sb = createSandbox(t, 'harvest-moved');
  writeSession(sb, { project: 'C--work-old', main: MAIN() });
  writeSession(sb, { project: 'C--work-new', main: MAIN() });
  assert.equal(findTranscripts(sb.env, SESSION).main.length, 2);
  const doc = buildUsage(sb.env, SESSION);
  assert.equal(doc.messages.length, 2);
  assert.equal(doc.sources.length, 2);
});

test('missing transcripts, unreadable lines and unsafe ids', (t) => {
  const sb = createSandbox(t, 'harvest-edge');
  assert.equal(harvestSession(sb.env, SESSION).status, 'missing');
  assert.equal(existsSync(usageFile(sb.env, SESSION)), false);
  writeSession(sb, { main: [...MAIN(), { type: 'assistant', timestamp: 'x', message: {} }] });
  const dir = path.join(projectsDir(sb.env), 'C--work-示範-專案');
  writeFileSync(path.join(dir, `${SESSION}.jsonl`), `${readFileSync(path.join(dir, `${SESSION}.jsonl`), 'utf8')}{broken\n`);
  const r = harvestSession(sb.env, SESSION);
  assert.equal(r.unparsed, 2);
  for (const bad of ['../x', '..', 'a/b', '']) assert.throws(() => findTranscripts(sb.env, bad), /invalid session id/);
});

test('asdk harvest by session, by task and for all sessions', (t) => {
  const sb = createSandbox(t, 'harvest-cli');
  writeSession(sb, { main: MAIN(), agents: [AGENT()] });
  writeSession(sb, { session: 'sess-other', main: response({ messageId: 'msg_o', requestId: 'req_o', usage: { output_tokens: 5 } }) });
  // Hook events tie SESSION to DEMO-001.
  appendEvent(sb.env, makeEvent({ source: 'cli', event: 'task.start', task_id: 'DEMO-001', project_id: 'demo-api', data: { type: 'feature', risk: 'low' } }));
  appendEvent(sb.env, makeEvent({ source: 'hook', event: 'SessionStart', session_id: SESSION, task_id: 'DEMO-001', project_id: 'demo-api' }), SESSION);
  appendEvent(sb.env, makeEvent({ source: 'hook', event: 'SessionStart', session_id: 'sess-other', project_id: null }), 'sess-other');

  let r = runAsdk(sb, ['harvest', '--task', 'DEMO-001', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).map((x) => [x.session_id, x.status]), [[SESSION, 'harvested']]);
  r = runAsdk(sb, ['harvest', '--all']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`^${SESSION}\\tunchanged\\t3 response`, 'm'));
  assert.match(r.stdout, /^sess-other\tharvested\t1 response/m);
  assert.match(runAsdk(sb, ['harvest', '--session', 'sess-none']).stdout, /no transcript found/);
  assert.equal(runAsdk(sb, ['harvest']).status, 2);
  assert.equal(runAsdk(sb, ['harvest', '--task', 'DEMO-009']).status, 1);
});
