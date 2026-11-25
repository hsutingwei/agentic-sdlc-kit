// Skill regression (P8b): the cases are fair, and prepare, run, score and compare work
// with a scripted reviewer (test/fixtures/fake-reviewer.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox } from '../../test/helpers/sandbox.mjs';
import { applyEdits, caseProblems, listCases, loadCase, parseEdits } from '../lib/cases.mjs';
import { checkFairness } from '../lib/fairness.mjs';
import { baselineOf, compareScores, matches, scoreRun } from '../lib/score.mjs';
import { main } from '../regress.mjs';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures', 'fake-reviewer.mjs');

test('there are eight cases with fifteen planted defects, none of them an E1 task', () => {
  const cases = listCases();
  assert.deepEqual(cases, ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08']);
  assert.equal(cases.reduce((n, id) => n + loadCase(id).suite.defects.length, 0), 15);
  const ids = cases.map((id) => loadCase(id).brief.task_id);
  assert.ok(ids.every((id) => Number(id.split('-')[1]) >= 201), 'E1 uses DEMO-101 to DEMO-112');
});

for (const id of listCases()) {
  test(`${id} is fair: the clean change passes everything, each planted defect fails its check but not the demo's tests`, (t) => {
    const c = loadCase(id);
    assert.deepEqual(caseProblems(c), []);
    const sb = createSandbox(t, `fair-${id}`);
    const { problems, defects } = checkFairness(sb.env, c, sb.join('案例'));
    assert.deepEqual(problems, []);
    assert.deepEqual(Object.keys(defects).sort(), c.suite.defects.map((d) => d.id).sort());
  });
}

test('edits are found exactly once or refused', (t) => {
  const edits = parseEdits('@@ a.txt defect D1\n<<<\nold\n===\nnew\n>>>\n');
  assert.deepEqual(edits, [{ file: 'a.txt', tag: { kind: 'defect', defect: 'D1' }, find: 'old', replace: 'new' }]);
  assert.throws(() => parseEdits('@@ a.txt\nold\n'), /expected <<</);
  assert.throws(() => parseEdits('@@ a.txt\n<<<\nold\n>>>\n'), /expected ===/);
  const sb = createSandbox(t, 'edits');
  writeFileSync(sb.join('a.txt'), 'x\r\nold\r\ny\n');
  assert.deepEqual(applyEdits(sb.root, edits), { D1: { file: 'a.txt', line: 2 } });
  assert.equal(readFileSync(sb.join('a.txt'), 'utf8'), 'x\nnew\ny\n');
  writeFileSync(sb.join('a.txt'), 'old old');
  assert.throws(() => applyEdits(sb.root, edits), /more than once/);
  assert.throws(() => applyEdits(sb.root, parseEdits('@@ a.txt\n<<<\nmissing\n===\nx\n>>>\n')), /not there/);
});

test('a finding matches a defect by file and a nearby line or its words', () => {
  const d = { file: 'src/server.mjs', keywords: ['limit=0'] };
  const where = { line: 40 };
  assert.equal(matches({ title: 'x', file: 'src/server.mjs', line: 44 }, d, where), true);
  assert.equal(matches({ title: 'x', file: 'src/server.mjs', line: 50 }, d, where), false);
  assert.equal(matches({ title: 'limit=0 passes', file: 'src/server.mjs', line: 90 }, d, where), true);
  assert.equal(matches({ title: 'limit=0 passes', file: 'src/todos.mjs' }, d, where), false);
  assert.equal(matches({ title: 'limit=0 passes in server.mjs' }, d, where), true);
  assert.equal(matches({ title: 'limit=0 passes' }, d, where), false);
});

test('scores count found, act_on and proven defects, and false alarms on clean changes', () => {
  const suite = { defects: [{ id: 'D1', file: 'src/a.mjs', keywords: ['k'] }, { id: 'D2', file: 'src/b.mjs', keywords: ['z'] }] };
  const done = (decision, findings) => ({ status: 'done', cost_usd: 0.05, final: { decision, findings }, verdict: { findings } });
  const s = scoreRun([
    { case: 'R01', variant: 'seeded', suite, defects: { D1: { line: 3 }, D2: { line: 9 } }, result: done('concerns', [{ id: 'F1', class: 'act_on', title: 'k', file: 'src/a.mjs', proven: true }]) },
    { case: 'R01', variant: 'real', suite, defects: {}, result: done('concerns', [{ id: 'F1', class: 'act_on', title: 'q', proven: false }]) },
    { case: 'R02', variant: 'seeded', suite, defects: {}, result: { status: 'invalid', problem: 'no JSON' } },
  ]);
  assert.deepEqual(
    [s.totals.defects, s.totals.hit, s.totals.act_on, s.totals.proven, s.totals.missed, s.totals.false_alarms, s.totals.clean_accepted, s.totals.not_reviewed],
    [4, 1, 1, 1, 3, 1, 0, 1],
  );
  const base = baselineOf(s, { model: 'm' });
  assert.deepEqual(base.defects['R01/D1'], { hit: true, act_on: true, proven: true });
  const worse = scoreRun([{ case: 'R01', variant: 'seeded', suite, defects: {}, result: done('accept', []) }, { case: 'R01', variant: 'real', suite, defects: {}, result: done('accept', [{ id: 'F1', class: 'act_on', title: 'a' }, { id: 'F2', class: 'act_on', title: 'b' }]) }]);
  assert.deepEqual(compareScores(base, worse), ['R01/D1 was found, now missed', 'R01 clean change: 2 false alarm(s), was 1']);
});

test('prepare, run, score and compare with a scripted reviewer', async (t) => {
  const sb = createSandbox(t, 'regress');
  const out = sb.join('回歸 run');
  const lines = [];
  const say = (l) => lines.push(l);
  const env = { ...sb.env, FAKE_REVIEW_MODE: 'accept' };
  assert.equal(await main(['prepare', out], { env, out: say }), 0);
  assert.match(lines.at(-1), /prepared 16 repositories \(8 cases, clean and seeded\)/);
  const key = JSON.parse(readFileSync(path.join(out, 'key.json'), 'utf8'));
  assert.ok(key.entries.every((e) => /^[0-9a-f]{10}$/.test(e.name)), 'neutral names');
  assert.ok(readdirSync(path.join(out, 'repos')).every((n) => !/real|seeded|R0/.test(n)));
  await assert.rejects(main(['prepare', out], { env, out: say }), /not empty/);
  await assert.rejects(main(['prepare', path.join(path.dirname(fileURLToPath(import.meta.url)), 'x')], { env, out: say }), /inside the kit/);

  assert.equal(await main(['run', out, '--claude', FAKE, '--only', 'R01,R04'], { env, out: say }), 0);
  assert.match(lines.at(-1), /4 review\(s\) with sonnet at high: 4 usable/);
  assert.equal(await main(['run', out, '--claude', FAKE, '--only', 'R01,R04'], { env, out: say }), 0);
  assert.match(lines.at(-1), /^0 review\(s\)/, 'finished reviews are not run again');

  const report = sb.join('score.md');
  assert.equal(await main(['score', out, '--label', 'accept everything', '--write', report], { env, out: say }), 0);
  const md = readFileSync(report, 'utf8');
  assert.match(md, /Planted defects found \| 0 of 15/);
  assert.match(md, /Clean changes accepted \| 2 of 2/);
  assert.match(md, /Runs without a usable verdict \| 12/);
  assert.ok(existsSync(path.join(out, 'score.json')));

  const baseline = sb.join('baseline.json');
  writeFileSync(baseline, JSON.stringify({ schema_version: 1, defects: { 'R01/D1': { hit: true, act_on: true, proven: false } }, false_alarms: {} }));
  assert.equal(await main(['compare', out, '--baseline', baseline], { env, out: say }), 1);
  assert.match(lines.at(-1), /1 regression\(s\):\n {2}R01\/D1 was found, now missed/);
  assert.equal(await main(['compare', out, '--baseline', baseline, '--write-baseline'], { env, out: say }), 0);
  assert.equal(await main(['compare', out, '--baseline', baseline], { env, out: say }), 0);
});
