import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, git, makeDemoRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { registerProject } from '../../collector/lib/registry.mjs';
import { readEvents } from '../../collector/lib/store.mjs';
import { loadTasks, startTask } from '../../collector/lib/tasks.mjs';
import { loadVerifyConfig, mismatch, runVerify, substitute } from '../verify/verify.mjs';

function setup(t, label) {
  const sb = createSandbox(t, label);
  const repo = makeDemoRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root: repo });
  return { sb, repo };
}

const commitAll = (sb, repo, message) => {
  git(sb, repo, 'add', '.');
  git(sb, repo, 'commit', '-q', '-m', message);
};

const closed = async (port) => {
  try {
    await fetch(`http://127.0.0.1:${port}/todos`, { signal: AbortSignal.timeout(1000) });
    return false;
  } catch {
    return true;
  }
};

test('placeholders keep the saved type, and expectations match a subset', () => {
  assert.deepEqual(substitute({ path: '/todos/{id}', json: { id: '{id}', note: 'id {id} on {port}', x: '{nope}' } }, { id: 7, port: 3001 }), {
    path: '/todos/7',
    json: { id: 7, note: 'id 7 on 3001', x: '{nope}' },
  });
  assert.equal(mismatch({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2], d: 4 }, e: 5 }), null);
  assert.equal(mismatch({ a: 1 }, { a: '1' }), 'a: expected 1, got "1"');
  assert.equal(mismatch({ b: { c: [1, 2] } }, { b: { c: [1] } }), 'b.c: expected an array of 2, got 1');
  assert.equal(mismatch({ list: [{ done: true }] }, { list: [{ done: false }] }), 'list[0].done: expected true, got false');
  assert.equal(mismatch({ a: null }, {}), 'a: expected null, got undefined');
});

test('the demo passes; evidence is kept, hashed and recorded on the exact commit', async (t) => {
  const { sb, repo } = setup(t, 'verify-pass');
  startTask(sb.env, { taskId: 'DEMO-001', cwd: repo, type: 'feature', risk: 'low' });
  const run = await runVerify(sb.env, { cwd: repo, taskId: 'DEMO-001', record: true });
  assert.equal(run.result, 'pass', JSON.stringify(run.evidence, null, 2));
  const text = readFileSync(run.file, 'utf8');
  assert.equal(createHash('sha256').update(text).digest('hex'), run.sha256);
  const e = JSON.parse(text);
  const head = git(sb, repo, 'rev-parse', 'HEAD').trim();
  assert.equal(e.head_sha, head);
  assert.equal(e.scenarios[0].steps.length, 7);
  assert.equal(e.scenarios[0].steps[0].response.status, 201);
  assert.match(e.scenarios[0].steps[0].response.body, /寫驗證情境/);
  assert.ok(run.file.startsWith(path.join(sb.env.AGENTIC_METRICS_HOME, 'evidence', 'demo-api', head)));

  const [v] = loadTasks(sb.env).get('DEMO-001').verifications;
  assert.deepEqual([v.check, v.result, v.executor, v.sha, v.evidence], ['ui', 'pass', 'script', head, run.sha256]);
  const event = readEvents(sb.env).events.find((x) => x.event === 'verify.run');
  assert.deepEqual([event.data.result, event.data.evidence, event.task_id], ['pass', run.sha256, 'DEMO-001']);
  assert.equal(await closed(e.port), true, 'the application is stopped');

  // Uncommitted changes: running is fine, recording is not.
  writeFileSync(path.join(repo, 'notes.txt'), 'draft\n');
  await assert.rejects(runVerify(sb.env, { cwd: repo, taskId: 'DEMO-001', record: true }), /commit or discard uncommitted changes/);
});

test('a failed expectation names the step and skips the rest; bodies can be left out', async (t) => {
  const { sb, repo } = setup(t, 'verify-fail');
  const file = path.join(repo, 'test', 'scenarios', 'todos-basic.json');
  writeFileSync(file, readFileSync(file, 'utf8').replace('"expect": { "status": 201, "json": { "title": "寫驗證情境", "done": false } }', '"expect": { "status": 201, "json": { "title": "寫驗證情境", "done": true } }'));
  const config = path.join(repo, '.asdk', 'verify.json');
  writeFileSync(config, readFileSync(config, 'utf8').replace('"record_bodies": true', '"record_bodies": false'));
  const run = await runVerify(sb.env, { cwd: repo });
  assert.equal(run.result, 'fail');
  const [first, second] = run.evidence.scenarios[0].steps;
  assert.deepEqual([first.result, first.reason, second.result], ['fail', 'done: expected true, got false', 'skipped']);
  assert.equal(first.response.body, undefined);
  assert.equal(first.request.json, undefined);

  const out = runAsdk(sb, ['verify', 'run', 'todos-basic'], { cwd: repo });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /FAIL {4}todos-basic\n {10}fail create a todo: done: expected true, got false/);
  assert.match(out.stdout, /result: fail/);
});

test('an application that never gets ready is an error, with its last output', async (t) => {
  const { sb, repo } = setup(t, 'verify-launch');
  const config = path.join(repo, '.asdk', 'verify.json');
  const c = JSON.parse(readFileSync(config, 'utf8'));
  c.launch.run = ['node', '-e', "console.error('數據庫 連線失敗'); process.exit(3)"];
  writeFileSync(config, JSON.stringify(c));
  const run = await runVerify(sb.env, { cwd: repo });
  assert.equal(run.result, 'error');
  assert.match(run.evidence.launch_problem, /exited with code 3 before it was ready/);
  assert.deepEqual(run.evidence.server_log_tail, ['數據庫 連線失敗']);

  c.launch.run = ['node', '-e', 'setInterval(() => {}, 1000)'];
  c.launch.timeout_ms = 500;
  writeFileSync(config, JSON.stringify(c));
  const slow = await runVerify(sb.env, { cwd: repo });
  assert.match(slow.evidence.launch_problem, /not ready within 500 ms/);

  c.launch.run = ['asdk-no-such-program-xyz'];
  writeFileSync(config, JSON.stringify(c));
  assert.match((await runVerify(sb.env, { cwd: repo })).evidence.launch_problem, /could not start asdk-no-such-program-xyz/);
});

test('everything the launcher started is stopped afterwards', async (t) => {
  const { sb, repo } = setup(t, 'verify-tree');
  // The launcher starts the server as a child of its own and waits, like npm start does.
  writeFileSync(
    path.join(repo, 'launch.mjs'),
    "import { spawn } from 'node:child_process';\nspawn(process.execPath, ['src/server.mjs'], { stdio: 'inherit' });\nsetInterval(() => {}, 1000);\n",
  );
  const config = path.join(repo, '.asdk', 'verify.json');
  writeFileSync(config, readFileSync(config, 'utf8').replace('"run": ["node", "src/server.mjs"]', '"run": ["node", "launch.mjs"]'));
  commitAll(sb, repo, 'chore: launch through a wrapper');
  const run = await runVerify(sb.env, { cwd: repo });
  assert.equal(run.result, 'pass', JSON.stringify(run.evidence));
  const port = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(run.evidence.server_log_tail.join('\n'))?.[1];
  assert.ok(port, run.evidence.server_log_tail.join('\n'));
  assert.equal(await closed(port), true, 'the grandchild server must be gone');
});

test('setup mistakes are named', (t) => {
  const { sb, repo } = setup(t, 'verify-config');
  const config = path.join(repo, '.asdk', 'verify.json');
  const good = JSON.parse(readFileSync(config, 'utf8'));
  for (const [change, message] of [
    [{ launch: { ...good.launch, run: 'node src/server.mjs' } }, /"launch\.run" must be an argv array/],
    [{ launch: { ...good.launch, ready: { path: 'todos' } } }, /must start with \//],
    [{ verifies: 'acceptance' }, /"verifies" must be one of/],
    [{ scenarios_dir: '../elsewhere' }, /inside the repository/],
  ]) {
    writeFileSync(config, JSON.stringify({ ...good, ...change }));
    assert.throws(() => loadVerifyConfig(repo), message);
  }
  writeFileSync(config, JSON.stringify(good));
  writeFileSync(path.join(repo, 'test', 'scenarios', 'broken.json'), JSON.stringify({ steps: [{ request: { method: 'FETCH', path: '/' }, expect: { status: 200 } }] }));
  const r = runAsdk(sb, ['verify', 'run'], { cwd: repo });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /scenario broken: step 1: request\.method must be one of/);
  assert.match(runAsdk(sb, ['verify', 'run', 'nope'], { cwd: repo }).stderr, /no scenario "nope"/);
  assert.match(runAsdk(sb, ['verify', 'list'], { cwd: repo }).stderr, /scenario broken/);
  assert.equal(runAsdk(sb, ['verify', 'run', '--record'], { cwd: repo }).status, 2);
});
