import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSandbox } from '../../test/helpers/sandbox.mjs';
import { acquireLock, LockTimeoutError, processAlive, withLock } from '../lock.mjs';

const WORKER = fileURLToPath(new URL('./fixtures/lock-worker.mjs', import.meta.url));

/** A pid that certainly belongs to no running process. */
function deadPid() {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(r.stdout);
}

const longAgo = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

test('a lock is exclusive and released by its owner', (t) => {
  const sb = createSandbox(t, 'lock-basic');
  const file = sb.join('鎖 目錄', 'tasks.lock');
  const release = acquireLock(file);
  assert.ok(existsSync(file));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pid, process.pid);
  assert.throws(() => acquireLock(file, { timeoutMs: 150 }), (err) => err instanceof LockTimeoutError && err.exitCode === 1 && /locked by process \d+ since/.test(err.message));
  release();
  assert.equal(existsSync(file), false);
  assert.equal(withLock(file, () => 42), 42);
  assert.equal(existsSync(file), false);
  assert.throws(() => withLock(file, async () => {}), /synchronous/);
  assert.equal(existsSync(file), false);
});

test('a stale lock of a process that is gone is taken over', (t) => {
  const sb = createSandbox(t, 'lock-stale');
  const file = sb.join('tasks.lock');
  const pid = deadPid();
  assert.equal(processAlive(pid), false);
  writeFileSync(file, JSON.stringify({ pid, ts: longAgo(), token: 'x' }));
  withLock(file, () => {}, { timeoutMs: 1000 });
  assert.equal(existsSync(file), false);
});

test('a recent lock, or an old one whose process still runs, is never taken', (t) => {
  const sb = createSandbox(t, 'lock-live');
  const file = sb.join('tasks.lock');
  writeFileSync(file, JSON.stringify({ pid: process.pid, ts: longAgo(), token: 'x' }));
  assert.throws(() => acquireLock(file, { timeoutMs: 150 }), LockTimeoutError);
  writeFileSync(file, JSON.stringify({ pid: deadPid(), ts: new Date().toISOString(), token: 'x' }));
  assert.throws(() => acquireLock(file, { timeoutMs: 150 }), LockTimeoutError);
  assert.ok(existsSync(file));
});

test('a half-written lock is judged by the file age', (t) => {
  const sb = createSandbox(t, 'lock-torn');
  const file = sb.join('tasks.lock');
  writeFileSync(file, '');
  assert.throws(() => acquireLock(file, { timeoutMs: 150 }), LockTimeoutError);
  const old = new Date(Date.now() - 60 * 60 * 1000);
  utimesSync(file, old, old);
  withLock(file, () => {}, { timeoutMs: 1000 });
});

test('release leaves a lock that is no longer its own', (t) => {
  const sb = createSandbox(t, 'lock-foreign');
  const file = sb.join('tasks.lock');
  const release = acquireLock(file);
  writeFileSync(file, JSON.stringify({ pid: 1, ts: new Date().toISOString(), token: 'someone-else' }));
  release();
  assert.ok(existsSync(file));
});

test('processes waiting on one lock, starting from a stale one, never overlap', async (t) => {
  const sb = createSandbox(t, 'lock-race');
  const file = sb.join('鎖', 'tasks.lock');
  const log = sb.join('log.txt');
  writeFileSync(log, '');
  // Everyone starts by finding a stale lock, so take-overs race too.
  acquireLock(file); // never released by this process ...
  writeFileSync(file, JSON.stringify({ pid: deadPid(), ts: longAgo(), token: 'stale' })); // ... and now stale

  const workers = 6;
  await Promise.all(
    Array.from({ length: workers }, () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [WORKER, file, log, '20', '3'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (d) => {
          stderr += d;
        });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
      }),
    ),
  );

  const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' '));
  assert.equal(lines.length, workers * 3 * 2);
  // Entries alternate enter/exit of the same process: no one entered while another held the lock.
  for (let i = 0; i < lines.length; i += 2) {
    assert.equal(lines[i][0], 'enter', `line ${i}`);
    assert.equal(lines[i + 1][0], 'exit', `line ${i + 1}`);
    assert.equal(lines[i][1], lines[i + 1][1]);
    assert.ok(Number(lines[i + 1][2]) >= Number(lines[i][2]));
  }
  assert.equal(existsSync(file), false);
});
