// Proving review findings: an "act_on" finding may carry a node:test file that asserts
// what the brief asks for. The kit runs it in a throw-away checkout of the reviewed
// commit; the finding counts as proven only when the test fails with an assertion.
// Anything else (no reproduction, refused imports, a crash, a pass) leaves it unproven.
//
// The import check guards against accidents, not against a hostile model: the test
// runs as the person with node, like any test an agent writes. See ADR-0009.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tryGit } from '../../core/git.mjs';
import { sterileEnv } from '../../adapters/claude-code/sterile.mjs';

export const ALLOWED_MODULES = ['node:test', 'node:assert', 'node:assert/strict', 'node:http', 'node:events', 'node:stream', 'node:buffer', 'node:url', 'node:util'];
const OUTPUT_TAIL = 2000;

/** Why a reproduction may not run, or null when it may. */
export function refuseReproduction(source) {
  if (/\brequire\s*\(/.test(source)) return 'require() is not allowed';
  if (/\bimport\s*\(/.test(source)) return 'a dynamic import() is not allowed';
  if (/\bprocess\s*\.\s*(binding|dlopen|kill|chdir)\b/.test(source)) return 'process control is not allowed';
  const specifiers = [...source.matchAll(/\bimport\b[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1|\bimport\s*(['"])([^'"]+)\3/g)].map((m) => m[2] ?? m[4]);
  if (/\bexport\b[^;]*\bfrom\b/.test(source)) return 're-exports are not allowed';
  for (const spec of specifiers) {
    if (spec.startsWith('./') || spec.startsWith('../')) {
      // relative imports stay inside the checkout: test/proof/ is two levels deep
      const depth = spec.split('/').filter((s) => s === '..').length;
      if (depth > 2) return `"${spec}" leaves the repository`;
      continue;
    }
    if (!ALLOWED_MODULES.includes(spec)) return `module "${spec}" is not allowed`;
  }
  return null;
}

const ASSERTION = /ERR_ASSERTION|AssertionError/;

/**
 * Runs the reproductions of `findings` against `sha` and returns one proof per finding
 * that has one: { id, status: 'proven' | 'not_reproduced' | 'refused' | 'error', detail }.
 */
export function proveFindings(env, { repo, sha, findings, timeoutS = 60 }) {
  const withTests = findings.filter((f) => f.class === 'act_on' && f.reproduction?.test);
  if (withTests.length === 0) return [];
  const base = mkdtempSync(path.join(os.tmpdir(), 'asdk-proof-'));
  const checkout = path.join(base, 'tree');
  const proofs = [];
  try {
    const added = tryGit(['worktree', 'add', '--detach', '-q', checkout, sha], { cwd: repo, env });
    if (!added.ok) return withTests.map((f) => ({ id: f.id, status: 'error', detail: `could not check out the commit: ${added.stderr.trim().slice(0, 200)}` }));
    mkdirSync(path.join(checkout, 'test', 'proof'), { recursive: true });
    for (const f of withTests) {
      const refused = refuseReproduction(f.reproduction.test);
      if (refused) {
        proofs.push({ id: f.id, status: 'refused', detail: refused });
        continue;
      }
      const file = path.join('test', 'proof', `${f.id}.test.mjs`);
      writeFileSync(path.join(checkout, file), f.reproduction.test);
      const r = spawnSync(process.execPath, ['--test', file], { cwd: checkout, env: sterileEnv(env), encoding: 'utf8', timeout: timeoutS * 1000, windowsHide: true });
      const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      const tail = output.slice(-OUTPUT_TAIL);
      if (r.error?.code === 'ETIMEDOUT') proofs.push({ id: f.id, status: 'error', detail: `no result within ${timeoutS} s` });
      else if (r.status === 0) proofs.push({ id: f.id, status: 'not_reproduced', detail: 'the test passed on this commit' });
      else if (ASSERTION.test(output)) proofs.push({ id: f.id, status: 'proven', detail: tail });
      else proofs.push({ id: f.id, status: 'error', detail: `the test failed without an assertion: ${tail}` });
    }
  } finally {
    tryGit(['worktree', 'remove', '--force', checkout], { cwd: repo, env });
    tryGit(['worktree', 'prune'], { cwd: repo, env });
    rmSync(base, { recursive: true, force: true });
  }
  return proofs;
}
