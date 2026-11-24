import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox, makeRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { registerProject } from '../lib/registry.mjs';
import { deriveSessions, setSessionProject } from '../lib/sessions.mjs';
import { appendEvent, makeEvent, readEvents } from '../lib/store.mjs';

const at = (min) => new Date(Date.UTC(2026, 10, 2, 9, min));
const hook = (fields, min) => makeEvent({ source: 'hook', tool: 'claude-code', ...fields }, at(min));

function setup(t, label) {
  const sb = createSandbox(t, label);
  const root = makeRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root });
  registerProject(sb.env, { id: 'demo-web', root: sb.home });
  return { sb, root };
}

test('sessions are derived from hook events, including sub-agents and failures', () => {
  const s = 'sess-1';
  const events = [
    hook({ event: 'SessionStart', session_id: s, project_id: 'demo-api', project_source: 'registry' }, 0),
    hook({ event: 'UserPromptSubmit', session_id: s, project_id: 'demo-api', project_source: 'registry' }, 1),
    hook({ event: 'PreToolUse', session_id: s, project_id: 'demo-api', project_source: 'registry' }, 2),
    hook({ event: 'SubagentStart', session_id: s, project_id: 'demo-api', project_source: 'registry', agent: { id: 'a1', type: 'implementer' } }, 3),
    hook({ event: 'PreToolUse', session_id: s, project_id: 'demo-api', project_source: 'git-common-dir', task_id: 'DEMO-001', agent: { id: 'a1', type: 'implementer' } }, 4),
    hook({ event: 'PostToolUseFailure', session_id: s, project_id: 'demo-api', project_source: 'git-common-dir', task_id: 'DEMO-001', agent: { id: 'a1', type: 'implementer' } }, 5),
    hook({ event: 'SubagentStop', session_id: s, project_id: 'demo-api', project_source: 'registry', agent: { id: 'a1', type: 'implementer' } }, 6),
    hook({ event: 'Stop', session_id: s, project_id: 'demo-api', project_source: 'registry' }, 7),
  ];
  const [one] = deriveSessions(events);
  assert.equal(one.project_id, 'demo-api');
  assert.equal(one.project_source, 'registry');
  assert.equal(one.events, 8);
  assert.equal(one.prompts, 1);
  assert.equal(one.tool_calls, 2);
  assert.equal(one.tool_failures, 1);
  assert.deepEqual(one.agents, { implementer: 1 });
  assert.deepEqual(one.task_ids, ['DEMO-001']);
  assert.equal(one.first_ts, at(0).toISOString());
  assert.equal(one.last_ts, at(7).toISOString());
  assert.equal(one.mixed_projects, false);
});

test('a manual override wins, the latest one counts, and recorded events stay as they were', (t) => {
  const { sb } = setup(t, 'sess-override');
  appendEvent(sb.env, hook({ event: 'SessionStart', session_id: 'sess-2', project_id: null, project_source: 'none' }, 0), 'sess-2');
  appendEvent(sb.env, hook({ event: 'Stop', session_id: 'sess-2', project_id: null, project_source: 'none' }, 1), 'sess-2');
  setSessionProject(sb.env, { sessionId: 'sess-2', projectId: 'demo-web', now: at(2) });
  setSessionProject(sb.env, { sessionId: 'sess-2', projectId: 'demo-api', reason: '在專案外啟動', now: at(3) });

  const { events } = readEvents(sb.env);
  const [one] = deriveSessions(events);
  assert.equal(one.project_id, 'demo-api');
  assert.equal(one.project_source, 'manual');
  assert.equal(one.recorded_project_id, null);
  assert.equal(one.events, 2);
  assert.deepEqual(
    events.filter((e) => e.source === 'hook').map((e) => e.project_id),
    [null, null],
  );
});

test('overrides are validated', (t) => {
  const { sb } = setup(t, 'sess-validate');
  assert.throws(() => setSessionProject(sb.env, { sessionId: '../x', projectId: 'demo-api' }), /invalid session id/);
  assert.throws(() => setSessionProject(sb.env, { sessionId: 's', projectId: 'demo-unknown' }), /unknown project/);
  assert.throws(() => setSessionProject(sb.env, { sessionId: 's', projectId: 'demo-api', reason: 'x'.repeat(257) }), /at most 256/);
});

test('sessions whose events resolve to different projects are marked mixed', () => {
  const [one] = deriveSessions([
    hook({ event: 'SessionStart', session_id: 's', project_id: 'demo-api', project_source: 'registry' }, 0),
    hook({ event: 'PreToolUse', session_id: 's', project_id: 'demo-web', project_source: 'registry' }, 1),
    hook({ event: 'Stop', session_id: 's', project_id: 'demo-web', project_source: 'registry' }, 2),
  ]);
  assert.equal(one.project_id, 'demo-web');
  assert.equal(one.mixed_projects, true);
});

test('asdk session set-project and session list', (t) => {
  const { sb, root } = setup(t, 'sess-cli');
  const payload = { session_id: 'sess-cli', cwd: sb.join('別處'), hook_event_name: 'SessionStart', source: 'startup' };
  assert.equal(runAsdk(sb, ['hook'], { input: JSON.stringify(payload) }).status, 0);

  let r = runAsdk(sb, ['session', 'list', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout)[0].project_source, 'none');

  r = runAsdk(sb, ['session', 'set-project', 'sess-cli', 'demo-api', '--reason', 'started outside the root'], { cwd: root });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  r = runAsdk(sb, ['session', 'list', '--project', 'demo-api']);
  assert.match(r.stdout, /^sess-cli\tdemo-api\tmanual\t/m);

  r = runAsdk(sb, ['session', 'set-project', 'sess-unseen', 'demo-api']);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /no hook events recorded/);
  assert.equal(runAsdk(sb, ['session', 'set-project', 'sess-cli', 'nope']).status, 2);
});
