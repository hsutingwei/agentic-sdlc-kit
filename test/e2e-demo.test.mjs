// End-to-end: DEMO-001 from task start to a scorecard row, with every step run
// through the real CLI. A script stands in for the implementer sub-agent, and
// hook events are fed through the exact command written into the hook settings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox, git, runAsdk, runNode } from './helpers/sandbox.mjs';
import { readEvents } from '../collector/lib/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SETUP = path.join(HERE, '..', 'tools', 'demo-setup.mjs');
const AGENT = path.join(HERE, 'fixtures', 'demo-001', 'agent.mjs');

test('DEMO-001 end to end', (t) => {
  const sb = createSandbox(t, 'e2e');
  const demo = sb.join('工作 區', 'demo-api');
  const step = (label, result, expected = 0) => {
    assert.equal(result.status, expected, `${label}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  const asdk = (args, cwd = demo) => runAsdk(sb, args, { cwd });

  // 1. A demo project of its own, registered, with hook settings.
  step('demo-setup', runNode(SETUP, [demo], { env: sb.env }));

  // 2. The task starts with an estimate of the effort without AI.
  step('task start', asdk(['task', 'start', 'DEMO-001', '--type', 'feature', '--risk', 'low', '--estimate', '6', '--title', 'Add due dates to todo items']));

  // 3. A worktree for the task; the hook settings follow it.
  const wt = JSON.parse(step('wt new', asdk(['wt', 'new', 'DEMO-001', '--slug', 'due-date', '--json'])));
  assert.ok(existsSync(path.join(wt.path, '.claude', 'settings.local.json')));

  // 4. Claude Code would now run in the worktree. Feed its hook events through the configured command.
  const settings = JSON.parse(readFileSync(path.join(wt.path, '.claude', 'settings.local.json'), 'utf8'));
  const hook = (payload) => {
    const r = spawnSync(settings.hooks[payload.hook_event_name][0].hooks[0].command, {
      shell: true,
      cwd: wt.path,
      env: sb.env,
      input: JSON.stringify({ session_id: 'sess-e2e', cwd: wt.path, ...payload }),
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
  };
  hook({ hook_event_name: 'SessionStart', source: 'startup' });
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'Use the implementer sub-agent on briefs/DEMO-001.json', prompt_id: 'p-1' });
  hook({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'implementer' }, tool_use_id: 'toolu_1' });
  hook({ hook_event_name: 'SubagentStart', agent_id: 'agent-e2e-1', agent_type: 'implementer' });

  // 5. First attempt: the sub-agent forgets the existing tests. G1 fails; nothing is merged.
  step('agent attempt 1', runNode(AGENT, [wt.path, 'attempt-1'], { env: sb.env }));
  const failed = step('wt finish (fails)', asdk(['wt', 'finish', 'DEMO-001']), 1);
  assert.match(failed, /FAIL {4}unit tests/);
  assert.match(failed, /not merged/);

  // 6. Second attempt fixes them. G1 passes on the rebased commit and the branch is merged into dev.
  step('agent attempt 2', runNode(AGENT, [wt.path, 'attempt-2'], { env: sb.env }));
  hook({ hook_event_name: 'SubagentStop', agent_id: 'agent-e2e-1', agent_type: 'implementer', last_assistant_message: '{"status":"completed"}' });
  hook({ hook_event_name: 'Stop', prompt_id: 'p-1', last_assistant_message: 'done' });
  const merged = step('wt finish', asdk(['wt', 'finish', 'DEMO-001']));
  assert.match(merged, /merged [0-9a-f]{12} as [0-9a-f]{12}/);
  assert.equal(existsSync(wt.path), false);
  assert.match(readFileSync(path.join(demo, 'src', 'todos.mjs'), 'utf8'), /due_date/);
  assert.match(git(sb, demo, 'log', '-1', '--format=%s'), /^Merge feat\/DEMO-001-due-date \(DEMO-001\)/);

  // 7. A human accepts the result.
  step('acceptance', asdk(['task', 'verify', 'DEMO-001', '--check', 'acceptance', '--result', 'pass', '--executor', 'human']));
  step('task end', asdk(['task', 'end', 'DEMO-001', '--outcome', 'accepted', '--completed-by', 'ai']));

  // 8. The scorecard row.
  const report = JSON.parse(step('report', asdk(['report', '--json'])));
  assert.equal(report.invalid_lines, 0);
  const [row] = report.rows;
  assert.equal(row.task_id, 'DEMO-001');
  assert.equal(row.project_id, 'demo-api');
  assert.equal(row.outcome, 'accepted');
  assert.equal(row.estimate_h, 6);
  assert.equal(typeof row.lead_time_h, 'number');
  assert.equal(row.verifications, 3); // G1 fail, G1 pass, human acceptance
  assert.equal(row.first_pass, false);
  assert.equal(row.gate_runs, 2);
  assert.equal(row.sessions, 1);
  assert.equal(row.subagents, 1);
  assert.equal(row.data_quality, 'Partial');
  assert.deepEqual(row.flags, ['no_human_time']);

  // Nothing the agent typed or read was stored.
  const all = JSON.stringify(readEvents(sb.env).events);
  assert.doesNotMatch(all, /briefs\/DEMO-001\.json|implementer sub-agent on/);
});
