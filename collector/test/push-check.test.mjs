import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, git, makeRepo, run, runAsdk } from '../../test/helpers/sandbox.mjs';
import { runGate } from '../../governance/gate/gate.mjs';
import { checkPushes, HOOK_MARK } from '../lib/push-check.mjs';
import { registerProject } from '../lib/registry.mjs';
import { readEvents } from '../lib/store.mjs';

// G1 passes unless a file named "bad" exists.
const GATES = {
  schema_version: 1,
  gates: { G1: { steps: [{ name: 'check', kind: 'unit', run: ['node', '-e', "process.exit(require('fs').existsSync('bad') ? 1 : 0)"] }] } },
  push_check: { remote: 'origin', branch: 'main', gate: 'G1' },
};

function setup(t, label) {
  const sb = createSandbox(t, label);
  const remote = sb.join('遠端 repo.git');
  git(sb, sb.root, 'init', '-q', '--bare', remote);
  const root = makeRepo(sb, sb.join('示範 專案'), { 'README.md': '# demo\n', '.asdk/gates.json': `${JSON.stringify(GATES, null, 2)}\n` });
  git(sb, root, 'remote', 'add', 'origin', remote);
  git(sb, root, 'push', '-q', 'origin', 'main'); // before any hook: only the reflog knows when
  registerProject(sb.env, { id: 'demo-api', root });
  const commit = (name, content = name) => {
    writeFileSync(path.join(root, name), content);
    git(sb, root, 'add', '.');
    git(sb, root, 'commit', '-q', '-m', `chore: ${name}`);
    return git(sb, root, 'rev-parse', 'HEAD').trim();
  };
  const push = () => run('git', ['push', 'origin', 'main'], { cwd: root, env: sb.env });
  const gate = () => runGate(sb.env, { gate: 'G1', cwd: root }).summary.result;
  return { sb, root, commit, push, gate };
}

test('pass, missing, after_push and failed, with push times from the hook and the reflog', (t) => {
  const { sb, root, commit, push, gate } = setup(t, 'push-states');
  const first = git(sb, root, 'rev-parse', 'HEAD').trim();
  const r0 = runAsdk(sb, ['push-check', 'install-hook'], { cwd: root });
  assert.equal(r0.status, 0, r0.stderr);

  const a = commit('a.txt');
  assert.equal(gate(), 'pass');
  assert.equal(push().status, 0);

  const b = commit('b.txt');
  const pushedB = push();
  assert.equal(pushedB.status, 0, 'the hook warns but never blocks');
  assert.match(pushedB.stderr, new RegExp(`${b.slice(0, 12)} is being pushed to main without a passing G1 run`));
  assert.equal(gate(), 'pass'); // only after the push

  const c = commit('bad');
  assert.equal(gate(), 'fail');
  push();

  assert.equal(runAsdk(sb, ['push-check', 'remove-hook'], { cwd: root }).status, 0);
  git(sb, root, 'rm', '-q', 'bad');
  git(sb, root, 'commit', '-q', '-m', 'fix: remove bad');
  const d = git(sb, root, 'rev-parse', 'HEAD').trim();
  assert.equal(gate(), 'pass');
  push();

  const r = checkPushes(sb.env, { projectId: 'demo-api' });
  const by = Object.fromEntries(r.commits.map((x) => [x.sha, x]));
  assert.equal(by[a].status, 'pass');
  assert.equal(by[a].push_time_source, 'hook');
  assert.equal(by[b].status, 'after_push');
  assert.equal(by[c].status, 'failed');
  assert.equal(by[d].status, 'pass');
  assert.equal(by[d].push_time_source, 'reflog');
  assert.equal(by[first].status, 'missing');
  assert.deepEqual(r.counts, { pass: 2, after_push: 1, failed: 1, missing: 1 });
  assert.equal(readEvents(sb.env).events.filter((e) => e.event === 'git.push').length, 3);
});

test('the hook never replaces a pre-push hook it did not write; pushes elsewhere are ignored', (t) => {
  const { sb, root } = setup(t, 'push-hook');
  const hooks = path.join(root, '.git', 'hooks', 'pre-push');
  writeFileSync(hooks, '#!/bin/sh\necho mine\n');
  const r = runAsdk(sb, ['push-check', 'install-hook'], { cwd: root });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not the kit's/);
  assert.equal(readFileSync(hooks, 'utf8'), '#!/bin/sh\necho mine\n');
  assert.equal(runAsdk(sb, ['push-check', 'remove-hook'], { cwd: root }).status, 1);

  writeFileSync(hooks, '');
  assert.equal(runAsdk(sb, ['push-check', 'install-hook'], { cwd: root }).status, 1); // still not ours
  rmSync(hooks);
  assert.equal(runAsdk(sb, ['push-check', 'install-hook'], { cwd: root }).status, 0);
  assert.match(readFileSync(hooks, 'utf8'), new RegExp(HOOK_MARK));
  // A push to another branch or remote is not recorded.
  const other = runAsdk(sb, ['push-check', 'record', 'origin'], { cwd: root, input: `refs/heads/dev ${'a'.repeat(40)} refs/heads/dev ${'0'.repeat(40)}\n` });
  assert.equal(other.status, 0);
  assert.equal(readEvents(sb.env).events.filter((e) => e.event === 'git.push').length, 0);
  assert.equal(existsSync(hooks), true);
});

test('push-check needs a configured project and reports usage errors', (t) => {
  const { sb, root } = setup(t, 'push-cli');
  let r = runAsdk(sb, ['push-check', '--json'], { cwd: root });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).gate, 'G1');
  r = runAsdk(sb, ['push-check'], { cwd: sb.home });
  assert.equal(r.status, 2);
  assert.equal(runAsdk(sb, ['push-check', '--limit', '0'], { cwd: root }).status, 2);
  writeFileSync(path.join(root, '.asdk', 'gates.json'), JSON.stringify({ ...GATES, push_check: { gate: 'G9' } }));
  r = runAsdk(sb, ['push-check'], { cwd: root });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /must name a configured gate/);
});
