// Every E1 task must be fair: its starting point passes the visible gates (a
// planted bug is not caught by them), its hidden tests fail there, and its
// reference solution, kept inside the brief's allowed paths, passes both.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox, makeDemoRepo } from './helpers/sandbox.mjs';
import { matchesGlob } from '../core/glob.mjs';
import { registerProject } from '../collector/lib/registry.mjs';
import { runGate } from '../governance/gate/gate.mjs';
import { commitOverlay, listTaskIds, loadTask, prepareBase, runHidden } from '../tools/experiment/lib/catalogue.mjs';

const ids = listTaskIds();

test('the catalogue has the twelve planned tasks', () => {
  assert.deepEqual(ids, Array.from({ length: 12 }, (_, i) => `DEMO-${101 + i}`));
});

for (const id of ids) {
  test(`${id}: fair start, hidden tests catch it, reference solution passes`, (t) => {
    const task = loadTask(id);
    const { allowed_paths: allowed, forbidden_paths: forbidden } = task.brief.scope;
    for (const f of task.solution) {
      assert.ok(allowed.some((g) => matchesGlob(f.rel, g)), `${f.rel} is outside the allowed paths`);
      assert.ok(!forbidden.some((g) => matchesGlob(f.rel, g)), `${f.rel} is forbidden`);
    }

    const sb = createSandbox(t, `e1-${id}`);
    const repo = makeDemoRepo(sb, sb.join('示範 專案'));
    registerProject(sb.env, { id: 'demo-api', root: repo });
    prepareBase(sb.env, { task, repo });

    const start = runGate(sb.env, { gate: 'G2', cwd: repo });
    assert.equal(start.summary.result, 'pass', `the starting point must pass G2\n${JSON.stringify(start.outputs, null, 2)}`);
    const before = runHidden(sb.env, { task, repo });
    assert.equal(before.result, 'fail', `hidden tests must fail at the start\n${before.output}`);

    commitOverlay(sb.env, { repo, files: task.solution, message: `feat: reference solution for ${id}` });
    const done = runGate(sb.env, { gate: 'G2', cwd: repo });
    assert.equal(done.summary.result, 'pass', `the reference solution must pass G2\n${JSON.stringify(done.outputs, null, 2)}`);
    const after = runHidden(sb.env, { task, repo });
    assert.equal(after.result, 'pass', `hidden tests must pass on the reference solution\n${after.output}`);
  });
}
