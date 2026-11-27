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
  const { sb, dir, baseEnv } = setup(t, 'e1-run-low');
  const argsFile = sb.join('fake-args.jsonl');
  const rec = executeRun(dir, { run: 'r01', task: 'DEMO-101', profile: 'pro', repeat: 1, pilot: true }, { baseEnv: { ...baseEnv, FAKE_CLAUDE_ARGS_FILE: argsFile }, claude });
  // The person's own settings and MCP servers are kept out; what the run was made with is kept.
  const [args] = readFileSync(argsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 3), ['--setting-sources', 'project,local', '--strict-mcp-config']);
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4), ['--model', 'sonnet', '--effort', 'high']);
  const started = runStates(dir).get('r01');
  assert.equal(started.claude_version, '0.0.0 (fake claude)');
  assert.match(started.kit_commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof started.kit_dirty, 'boolean');
  assert.deepEqual([rec.stage, rec.first_gate, rec.merged, rec.risk.effective, rec.attempts.length], ['review', 'pass', true, 'low', 1]);
  assert.deepEqual([rec.first_scope, rec.outside_scope, rec.scope_blocked], ['pass', 0, false]);
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
  assert.deepEqual([rec.first_scope, rec.outside_scope], ['pass', 0], 'the first change failed the gate inside its scope');
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

test('a change outside the brief\'s scope gets one retry with the files named', (t) => {
  const { sb, dir, baseEnv } = setup(t, 'e1-run-scope', 'stray-then-fix');
  const argsFile = sb.join('fake-args.jsonl');
  const rec = executeRun(dir, { run: 'r04', task: 'DEMO-101', profile: 'pro', repeat: 1, pilot: false }, { baseEnv: { ...baseEnv, FAKE_CLAUDE_ARGS_FILE: argsFile }, claude });
  assert.deepEqual([rec.first_gate, rec.first_scope, rec.outside_scope, rec.attempts.length], ['pass', 'fail', 0, 2]);
  assert.deepEqual([rec.merged, rec.gate_failed, rec.scope_blocked], [true, false, false]);
  const retry = readFileSync(argsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))[1];
  const prompt = retry[retry.indexOf('-p') + 1];
  assert.match(prompt, /^wt finish did not merge your work on briefs\/DEMO-101\.json: the change has files outside the scope/);
  assert.match(prompt, / {2}docs\/筆記 notes\.md {2}not in the allowed paths$/);
  assert.equal(existsSync(path.join(dir, 'runs', 'r04', 'demo-api', 'docs')), false, 'the stray file was not merged');
});

test('a change still outside the scope after the retry is left for a person', (t) => {
  const { dir, baseEnv } = setup(t, 'e1-run-stray', 'stray');
  const rec = executeRun(dir, { run: 'r05', task: 'DEMO-101', profile: 'pro', repeat: 1, pilot: false }, { baseEnv, claude });
  assert.deepEqual([rec.stage, rec.first_gate, rec.first_scope, rec.outside_scope, rec.attempts.length], ['review', 'pass', 'fail', 1, 2]);
  assert.deepEqual([rec.merged, rec.gate_failed, rec.scope_blocked], [false, false, true]);
  assert.match(rec.head_sha, /^[0-9a-f]{40}$/);
  const env = { ...baseEnv, AGENTIC_METRICS_HOME: path.join(dir, 'runs', 'r05', 'metrics') };
  assert.match(loadTasks(env).get('DEMO-101').escalations[0].reason, /outside the scope of its brief after one retry/);
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
