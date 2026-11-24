// The E1 runner, with a scripted stand-in for `claude -p` (fixtures/fake-claude.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox, git } from './helpers/sandbox.mjs';
import { readEvents } from '../collector/lib/store.mjs';
import { loadTasks } from '../collector/lib/tasks.mjs';
import { runStates } from '../tools/experiment/lib/plan.mjs';
import { executeRun, quotaAllows, runEnv } from '../tools/experiment/lib/run.mjs';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');
const claude = { command: process.execPath, args: [FAKE] };

function setup(t, label, mode = 'solve') {
  const sb = createSandbox(t, label);
  const dir = sb.join('實驗 E1');
  return { sb, dir, baseEnv: { ...sb.env, FAKE_CLAUDE_MODE: mode, CLAUDE_CODE_EFFORT_LEVEL: 'low' } };
}

test('a low-risk run merges after the gate; the kit records it in the run folder', (t) => {
  const { dir, baseEnv } = setup(t, 'e1-run-low');
  const rec = executeRun(dir, { run: 'r01', task: 'DEMO-101', profile: 'pro', repeat: 1, pilot: true }, { baseEnv, claude });
  assert.deepEqual([rec.stage, rec.first_gate, rec.merged, rec.risk.effective, rec.attempts.length], ['review', 'pass', true, 'low', 1]);
  assert.deepEqual(rec.quota, { five_hour: 42, seven_day: 10 });

  const env = { ...baseEnv, AGENTIC_METRICS_HOME: path.join(dir, 'runs', 'r01', 'metrics') };
  const task = loadTasks(env).get('DEMO-101');
  assert.deepEqual([task.profile, task.estimate_hours, task.verifications[0].gate], ['pro', 1.5, 'G1']);
  const events = readEvents(env).events;
  assert.ok(events.some((e) => e.event === 'quota.snapshot' && e.data.source === 'stream-json'));
  assert.ok(events.some((e) => e.event === 'quota.plan-change' && e.data.plan === 'pro'));

  // The agent got the profile: planner flags on the session, model and effort in the agent file.
  const stream = readFileSync(path.join(dir, 'runs', 'r01', 'agent-1.jsonl'), 'utf8');
  assert.match(stream, /"model":"sonnet"/);
  const repo = path.join(dir, 'runs', 'r01', 'demo-api');
  assert.match(readFileSync(path.join(repo, '.claude', 'agents', 'implementer.md'), 'utf8'), /model: sonnet\neffort: high/);
  assert.match(git({ env }, repo, 'log', '--format=%s', 'dev'), /chore: E1 setup \(pro profile, merge policy\)/);
  assert.ok(existsSync(path.join(dir, 'bin', 'asdk.cmd')) && existsSync(path.join(dir, 'bin', 'asdk')));
});

test('a medium-risk run waits for the human review; a failed gate gets one retry', (t) => {
  const { dir, baseEnv } = setup(t, 'e1-run-retry', 'break-then-fix');
  const rec = executeRun(dir, { run: 'r02', task: 'DEMO-102', profile: 'ultra', repeat: 1, pilot: false }, { baseEnv, claude });
  assert.deepEqual([rec.first_gate, rec.attempts.length, rec.merged, rec.gate_failed, rec.risk.effective], ['fail', 2, false, false, 'medium']);
  assert.match(readFileSync(path.join(dir, 'runs', 'r02', 'agent-1.jsonl'), 'utf8'), /"model":"opus"/);
  assert.equal(runStates(dir).get('r02').stage, 'review');
});

test('two failed gates end as an escalation, still for the person to look at', (t) => {
  const { dir, baseEnv } = setup(t, 'e1-run-fail', 'break');
  const rec = executeRun(dir, { run: 'r03', task: 'DEMO-109', profile: 'max', repeat: 1, pilot: false }, { baseEnv, claude });
  assert.deepEqual([rec.stage, rec.gate_failed, rec.attempts.length, rec.merged], ['review', true, 2, false]);
  const env = { ...baseEnv, AGENTIC_METRICS_HOME: path.join(dir, 'runs', 'r03', 'metrics') };
  assert.equal(loadTasks(env).get('DEMO-109').escalations.length, 1);
});

test('the run environment drops settings that would change the outcome', () => {
  const env = runEnv({ PATH: '/usr/bin', CLAUDE_CODE_EFFORT_LEVEL: 'low', ANTHROPIC_MODEL: 'x', AGENTIC_METRICS_HOME: '/real', HOME: '/home/dev' }, { metrics: '/m', bin: '/b' });
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, undefined);
  assert.equal(env.ANTHROPIC_MODEL, undefined);
  assert.equal(env.AGENTIC_METRICS_HOME, '/m');
  assert.equal(env.HOME, '/home/dev');
  assert.ok(env.PATH.startsWith(`/b${path.delimiter}`));
  assert.deepEqual(quotaAllows({ five_hour: 79.9, seven_day: 20 }), { ok: true, over: [] });
  assert.equal(quotaAllows({ five_hour: 80 }).ok, false);
});
