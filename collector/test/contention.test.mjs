// Real processes racing for the same records: what the locks are for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { acquireLock } from '../../core/lock.mjs';
import { ASDK, createSandbox, makeRepo } from '../../test/helpers/sandbox.mjs';
import { deriveHumanTime } from '../lib/human-time.mjs';
import { lockFile } from '../lib/locks.mjs';
import { loadConfig, registerProject } from '../lib/registry.mjs';
import { readEvents } from '../lib/store.mjs';
import { deriveTasks, startTask } from '../lib/tasks.mjs';

const RACERS = 8;

const REGISTER_WORKER = fileURLToPath(new URL('./fixtures/register-worker.mjs', import.meta.url));

/** Runs a node script asynchronously, so several can run at once. */
function run(sb, args, { cwd = sb.root, env = sb.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const asdk = (sb, args, options) => run(sb, [ASDK, ...args], options);

function setup(t, label) {
  const sb = createSandbox(t, label);
  const root = makeRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root });
  return { sb, root };
}

test('racing task starts of one id: exactly one wins', async (t) => {
  const { sb, root } = setup(t, 'race-start');
  const results = await Promise.all(
    Array.from({ length: RACERS }, () => asdk(sb, ['task', 'start', 'DEMO-001', '--type', 'feature', '--risk', 'low'], { cwd: root })),
  );
  assert.equal(results.filter((r) => r.status === 0).length, 1, results.map((r) => r.stderr).join('\n'));
  for (const r of results.filter((x) => x.status !== 0)) {
    assert.equal(r.status, 1);
    assert.match(r.stderr, /already exists/);
  }
  const { events } = readEvents(sb.env);
  assert.equal(events.filter((e) => e.event === 'task.start').length, 1);
  assert.equal(deriveTasks(events).tasks.get('DEMO-001').flags.size, 0);
});

test('racing project adds: no entry is lost', async (t) => {
  const sb = createSandbox(t, 'race-config');
  const perWorker = 10;
  const results = await Promise.all(
    Array.from({ length: RACERS }, (_, w) => run(sb, [REGISTER_WORKER, String(w), String(perWorker), sb.join('專案')])),
  );
  assert.deepEqual(results.map((r) => r.status), Array(RACERS).fill(0), results.map((r) => r.stderr).join('\n'));
  assert.equal(loadConfig(sb.env).projects.length, RACERS * perWorker);
});

test('racing human timers: always exactly one running, never overlapping', async (t) => {
  const { sb, root } = setup(t, 'race-human');
  const ids = Array.from({ length: RACERS }, (_, i) => `DEMO-${String(i + 1).padStart(3, '0')}`);
  for (const id of ids) startTask(sb.env, { taskId: id, cwd: root, type: 'feature', risk: 'low' });

  const results = await Promise.all(ids.map((id) => asdk(sb, ['human', 'start', id, '--switch'])));
  assert.deepEqual(results.map((r) => r.status), Array(RACERS).fill(0), results.map((r) => r.stderr).join('\n'));

  const { events } = readEvents(sb.env);
  const { open, tasks } = deriveHumanTime(events);
  assert.ok(open && ids.includes(open.task_id));
  assert.equal(events.filter((e) => e.event === 'human.start').length, RACERS);
  assert.equal(events.filter((e) => e.event === 'human.stop').length, RACERS - 1);
  for (const [id, rec] of tasks) assert.deepEqual([...rec.flags], [], id);
});

test('a held lock makes a writer give up with a clear message, and leaves no trace', async (t) => {
  const { sb, root } = setup(t, 'race-timeout');
  const release = acquireLock(lockFile(sb.env, 'tasks'));
  try {
    const r = await asdk(sb, ['task', 'start', 'DEMO-001', '--type', 'feature', '--risk', 'low'], { cwd: root, env: { ...sb.env, AGENTIC_LOCK_TIMEOUT_MS: '300' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, new RegExp(`the tasks lock is locked by process ${process.pid} since`));
  } finally {
    release();
  }
  assert.equal(readEvents(sb.env).events.filter((e) => e.event === 'task.start').length, 0);
});
