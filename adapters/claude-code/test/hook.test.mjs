import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, git, makeRepo, runAsdk } from '../../../test/helpers/sandbox.mjs';
import { dataPath } from '../../../collector/lib/paths.mjs';
import { registerProject } from '../../../collector/lib/registry.mjs';
import { writeWorktreeMarker } from '../../../collector/lib/state.mjs';
import { readEvents } from '../../../collector/lib/store.mjs';
import { payloadToEvent } from '../hook.mjs';

// Payload shapes follow what Claude Code 2.1.330 sent in the spike (docs/spike).
const SECRET = 'TOP-SECRET-CONTENT';

function setup(t, label) {
  const sb = createSandbox(t, label);
  const root = makeRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root });
  const wt = sb.join('wt', 'demo-api', 'DEMO-001');
  git(sb, root, 'worktree', 'add', '-q', '-b', 'feat/DEMO-001', wt);
  writeWorktreeMarker(sb.env, { task_id: 'DEMO-001', project_id: 'demo-api', slot: 'DEMO-001', path: wt, branch: 'feat/DEMO-001' });
  return { sb, root, wt };
}

test('content fields become sizes; nothing secret is kept', (t) => {
  const { sb, wt } = setup(t, 'hook-map');
  const e = payloadToEvent(
    {
      session_id: 'sess-1',
      transcript_path: path.join(wt, 'transcript.jsonl'),
      cwd: wt,
      hook_event_name: 'PostToolUse',
      permission_mode: 'default',
      tool_name: 'Edit',
      tool_use_id: 'toolu_01',
      tool_input: { file_path: path.join(wt, 'src', 'secret.js'), new_string: SECRET },
      tool_response: { type: 'text', file: { content: SECRET } },
      duration_ms: 12,
    },
    { env: sb.env },
  );
  const json = JSON.stringify(e);
  assert.doesNotMatch(json, new RegExp(SECRET));
  assert.doesNotMatch(json, /secret\.js|transcript/);
  assert.equal(e.data.tool_name, 'Edit');
  assert.equal(e.data.file_count, 1);
  assert.ok(e.data.tool_input_bytes > SECRET.length);
  assert.ok(e.data.tool_response_bytes > SECRET.length);
  assert.equal(e.project_id, 'demo-api');
  assert.equal(e.project_source, 'git-common-dir');
  assert.equal(e.worktree, 'DEMO-001');
  assert.equal(e.task_id, 'DEMO-001');
});

test('sub-agent and prompt fields', (t) => {
  const { sb, root } = setup(t, 'hook-agent');
  const sub = payloadToEvent({ session_id: 's', cwd: root, hook_event_name: 'SubagentStop', agent_id: 'a335511527b9d0f06', agent_type: 'implementer', last_assistant_message: '完成了' }, { env: sb.env });
  assert.deepEqual(sub.agent, { id: 'a335511527b9d0f06', type: 'implementer' });
  assert.equal(sub.data.last_message_chars, 3);
  assert.equal(sub.task_id, undefined); // the main checkout is not a task worktree

  const prompt = payloadToEvent({ session_id: 's', cwd: root, hook_event_name: 'UserPromptSubmit', prompt: SECRET, prompt_id: 'p-1' }, { env: sb.env });
  assert.equal(prompt.data.prompt_chars, SECRET.length);
  assert.equal(prompt.data.prompt_id, 'p-1');
});

test('unknown or unsafe values are dropped', (t) => {
  const { sb } = setup(t, 'hook-unsafe');
  assert.equal(payloadToEvent({ cwd: sb.home }, { env: sb.env }), null);
  assert.equal(payloadToEvent({ hook_event_name: 'Bad Name!' }, { env: sb.env }), null);
  const e = payloadToEvent({ hook_event_name: 'Stop', session_id: '../../etc', agent_id: 'x/y', cwd: sb.home }, { env: sb.env });
  assert.equal(e.session_id, undefined);
  assert.equal(e.agent, undefined);
  assert.equal(e.project_id, null);
  assert.equal(e.project_source, 'none');
});

test('asdk hook records an event and always exits 0', (t) => {
  const { sb, wt } = setup(t, 'hook-cli');
  const payload = { session_id: 'sess-cli', cwd: wt, hook_event_name: 'SessionStart', source: 'startup' };
  const ok = runAsdk(sb, ['hook'], { input: JSON.stringify(payload) });
  assert.equal(ok.status, 0, ok.stderr);
  const { events } = readEvents(sb.env);
  assert.equal(events.length, 1);
  assert.equal(events[0].task_id, 'DEMO-001');
  assert.equal(events[0].data.source, 'startup');

  const bad = runAsdk(sb, ['hook'], { input: `not json ${SECRET}` });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout + bad.stderr, '');
  const log = readFileSync(dataPath(sb.env, 'collector-errors.log'), 'utf8');
  assert.match(log, /payload is not valid JSON/);
  assert.doesNotMatch(log, new RegExp(SECRET));
  assert.equal(readEvents(sb.env).events.length, 1);
});

test('a broken metrics directory does not break the hook', (t) => {
  const { sb, wt } = setup(t, 'hook-broken');
  // Point the store at a path that is a file, so every write fails.
  const env = { ...sb.env, AGENTIC_METRICS_HOME: path.join(wt, 'README.md') };
  const r = runAsdk(sb, ['hook'], { env, input: JSON.stringify({ hook_event_name: 'Stop', cwd: wt }) });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(existsSync(path.join(wt, 'README.md', 'events')), false);
});
