// Every task must be fair: its starting point passes the visible gates (a planted
// bug is not caught by them), its hidden tests fail there, and its reference
// solution, kept inside the brief's allowed paths, passes both.
//
// An E2 task is also hard for a stated reason: it has a half-done version (naive/,
// laid over the reference solution) that passes the same gates, stays inside the
// scope, passes some of the hidden tests and fails others.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox, git, makeDemoRepo } from './helpers/sandbox.mjs';
import { matchesGlob } from '../core/glob.mjs';
import { registerProject } from '../collector/lib/registry.mjs';
import { runGate } from '../governance/gate/gate.mjs';
import { commitOverlay, listTaskIds, loadTask, prepareBase, runHidden } from '../tools/experiment/lib/catalogue.mjs';

const range = (from, count) => Array.from({ length: count }, (_, i) => `DEMO-${from + i}`);

test('the catalogue has the twelve E1 tasks and the eight E2 tasks', () => {
  assert.deepEqual(listTaskIds('e1'), range(101, 12));
  assert.deepEqual(listTaskIds('e2'), range(201, 8));
  assert.deepEqual(listTaskIds(), listTaskIds('e1'));
});

function inScope(task, files, what) {
  const { allowed_paths: allowed, forbidden_paths: forbidden } = task.brief.scope;
  for (const f of files) {
    assert.ok(allowed.some((g) => matchesGlob(f.rel, g)), `${what}: ${f.rel} is outside the allowed paths`);
    assert.ok(!forbidden.some((g) => matchesGlob(f.rel, g)), `${what}: ${f.rel} is forbidden`);
  }
}

for (const suite of ['e1', 'e2']) {
  for (const id of listTaskIds(suite)) {
    test(`${id}: fair start, hidden tests catch it, reference solution passes`, (t) => {
      const task = loadTask(id);
      inScope(task, task.solution, 'the reference solution');
      inScope(task, task.naive, 'the half-done version');
      assert.equal(task.naive.length > 0, suite === 'e2', 'E2 tasks, and only they, have a half-done version');

      const sb = createSandbox(t, `${suite}-${id}`);
      const repo = makeDemoRepo(sb, sb.join('示範 專案'));
      registerProject(sb.env, { id: 'demo-api', root: repo });
      const startSha = prepareBase(sb.env, { task, repo });
      const gate = (what) => {
        const run = runGate(sb.env, { gate: 'G2', cwd: repo });
        assert.equal(run.summary.result, 'pass', `${what} must pass G2\n${JSON.stringify(run.outputs, null, 2)}`);
      };

      gate('the starting point');
      const before = runHidden(sb.env, { task, repo });
      assert.equal(before.result, 'fail', `hidden tests must fail at the start\n${before.output}`);

      if (task.naive.length > 0) {
        commitOverlay(sb.env, { repo, files: [...task.solution, ...task.naive], message: `feat: half of ${id}` });
        gate('the half-done version');
        const half = runHidden(sb.env, { task, repo });
        assert.ok(half.passed > 0 && half.failed > 0, `the half-done version must pass some hidden tests and fail others: ${half.passed} passed, ${half.failed} failed\n${half.output}`);
        git(sb, repo, 'reset', '-q', '--hard', startSha);
      }

      commitOverlay(sb.env, { repo, files: task.solution, message: `feat: reference solution for ${id}` });
      gate('the reference solution');
      const after = runHidden(sb.env, { task, repo });
      assert.equal(after.result, 'pass', `hidden tests must pass on the reference solution\n${after.output}`);
    });
  }
}
