// A case is fair when its clean change passes the demo's own tests and every check,
// and its seeded change still passes the demo's own tests (so a gate would let it
// through to the reviewer) while each check fails on it. The clean change also stays
// inside its brief's scope, so the kit's scope check cannot raise a false alarm on it.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { changedPaths } from '../../governance/gate/risk.mjs';
import { scopeCheck } from '../../governance/gate/scope.mjs';
import { failureKind } from '../../governance/review/proof.mjs';
import { buildVariant, placeChecks } from './cases.mjs';

const OWN_TESTS = ['test/unit/**/*.test.mjs', 'test/integration/**/*.test.mjs'];

function nodeTest(repo, env, files) {
  const childEnv = { ...env };
  for (const k of Object.keys(childEnv)) if (k.toUpperCase() === 'NODE_TEST_CONTEXT') delete childEnv[k];
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: repo, env: childEnv, encoding: 'utf8', timeout: 120000, windowsHide: true });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * @returns {{ problems: string[], defects: Record<string, { file: string, line: number }> }}
 */
export function checkFairness(env, c, workDir) {
  const problems = [];
  const real = buildVariant(env, c, 'real', path.join(workDir, 'real'));
  const own = nodeTest(real.repo, env, OWN_TESTS);
  const { outside } = scopeCheck(c.brief, changedPaths(real.repo, env, { base: real.base, head: real.sha }));
  if (outside.length) problems.push(`the clean change leaves the brief's scope: ${outside.map((o) => o.path).join(', ')}`);
  if (!own.ok) problems.push(`the clean change fails the demo's tests:\n${own.output.slice(-1500)}`);
  for (const check of placeChecks(c, real.repo)) {
    const r = nodeTest(real.repo, env, [check.rel]);
    if (!r.ok) problems.push(`check ${check.id} fails on the clean change:\n${r.output.slice(-1500)}`);
  }

  const seeded = buildVariant(env, c, 'seeded', path.join(workDir, 'seeded'));
  const ownSeeded = nodeTest(seeded.repo, env, OWN_TESTS);
  if (!ownSeeded.ok) problems.push(`the seeded change fails the demo's tests, so a gate would stop it before any review:\n${ownSeeded.output.slice(-1500)}`);
  for (const check of placeChecks(c, seeded.repo)) {
    const r = nodeTest(seeded.repo, env, [check.rel]);
    if (r.ok) problems.push(`check ${check.id} passes on the seeded change, so the defect is not there`);
    else if (failureKind(r.output) === 'other') problems.push(`check ${check.id} fails on the seeded change, but not through an assertion or the code under test:\n${r.output.slice(-1500)}`);
  }
  return { problems, defects: seeded.defects };
}
