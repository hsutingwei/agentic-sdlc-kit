// The E2 command line: its plan, the pilot in a folder of its own, and a run on
// the larger starting point, with the scripted agent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createSandbox } from './helpers/sandbox.mjs';
import { main as e1 } from '../tools/experiment/e1.mjs';
import { main as e2 } from '../tools/experiment/e2.mjs';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');
const readPlan = (dir) => JSON.parse(readFileSync(path.join(dir, 'plan.json'), 'utf8'));

test('E2 plans every task with every profile twice, without a pilot inside', async (t) => {
  const sb = createSandbox(t, 'e2-plan');
  const lines = [];
  const io = { out: (l) => lines.push(l), baseEnv: sb.env, output: new PassThrough() };
  const dir = sb.join('實驗 E2');
  assert.equal(await e2(['init', dir, '--seed', '5'], io), 0);
  assert.match(lines.at(-1), /planned 48 runs in .* \(seed 5\); every task with every profile, 2 times/);
  const plan = readPlan(dir);
  assert.deepEqual([plan.suite, plan.purpose, plan.pilot, plan.runs.length], ['e2', 'results', null, 48]);
  const cells = new Map();
  for (const r of plan.runs) cells.set(`${r.task} ${r.profile}`, [...(cells.get(`${r.task} ${r.profile}`) ?? []), r.repeat]);
  assert.equal(cells.size, 24);
  assert.ok([...cells.values()].every((repeats) => repeats.sort().join() === '1,2'));
  assert.ok(plan.runs.every((r) => /^DEMO-20[1-8]$/.test(r.task) && r.pilot === false));
  await assert.rejects(e2(['run', dir, '--pilot', '--claude', FAKE], io), /no pilot runs of its own/);
  await assert.rejects(e1(['status', dir], io), /holds an e2 experiment; use e2\.mjs/);
  await assert.rejects(e1(['init', sb.join('另一個'), '--pilot'], io), /use "run --pilot"/);
});

test('an E2 pilot is a plan of its own; a run starts from the larger demo', async (t) => {
  const sb = createSandbox(t, 'e2-pilot');
  const lines = [];
  const io = { out: (l) => lines.push(l), baseEnv: { ...sb.env, FAKE_CLAUDE_MODE: 'solve' }, output: new PassThrough() };
  const dir = sb.join('實驗 E2 試跑');
  assert.equal(await e2(['init', dir, '--pilot'], io), 0);
  assert.match(lines.at(-1), /planned 8 runs in .*; a pilot: every task once with pro; its runs are not part of the results/);
  const plan = readPlan(dir);
  assert.equal(plan.purpose, 'pilot');
  assert.deepEqual(plan.runs.map((r) => r.task).sort(), Array.from({ length: 8 }, (_, i) => `DEMO-${201 + i}`));
  assert.ok(plan.runs.every((r) => r.profile === 'pro' && r.repeat === 1));

  assert.equal(await e2(['run', dir, '--limit', '1', '--claude', FAKE], io), 0);
  const first = plan.runs[0];
  assert.ok(lines.some((l) => l.startsWith(`r01 ${first.task}: gate passed, 1 attempt(s)`)), lines.join('\n'));
  assert.ok(existsSync(path.join(dir, 'runs', 'r01', 'demo-api', 'src', 'storage.mjs')), 'the E2 base is in the run');

  assert.equal(await e2(['check', dir], io), 0);
  assert.match(lines.at(-1), /1 run\(s\) checked: 1 pass their hidden tests, 0 fail/);
  assert.equal(await e2(['analyze', dir], io), 0);
  const summary = readFileSync(path.join(dir, 'analysis', 'summary.md'), 'utf8');
  assert.match(summary, /^# E2 pilot \(not part of the results\)\n\nRuns finished: 1 of 8 planned/);
  assert.match(summary, new RegExp(`\\| ${first.task} \\|.*H✓`));

  // A run whose change stays outside the brief's scope is told so once, then left for a person.
  const stray = { ...io, baseEnv: { ...io.baseEnv, FAKE_CLAUDE_MODE: 'stray' } };
  assert.equal(await e2(['run', dir, '--limit', '1', '--claude', FAKE], stray), 0);
  const second = plan.runs[1];
  assert.ok(lines.some((l) => l.startsWith(`r02 ${second.task}: gate passed, still outside the scope, 2 attempt(s)`)), lines.join('\n'));
  assert.equal(await e2(['check', dir], io), 0);
  assert.equal(await e2(['analyze', dir], io), 0);
  const [header, ...rows] = readFileSync(path.join(dir, 'analysis', 'runs.csv'), 'utf8').trim().split('\r\n').map((l) => l.split(','));
  const of = (run, name) => rows.find((row) => row[0] === run)[header.indexOf(name)];
  assert.deepEqual([of('r01', 'first_scope'), of('r01', 'outside_scope'), of('r02', 'first_scope'), of('r02', 'outside_scope'), of('r02', 'merged')], ['pass', '0', 'fail', '1', 'false']);
  assert.match(readFileSync(path.join(dir, 'analysis', 'summary.md'), 'utf8'), new RegExp(`\\| ${second.task} \\|.*S✗ H✓`));
});
