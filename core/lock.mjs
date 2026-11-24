// Lock files for read -> check -> write sequences across processes.
//
// A lock is a file created with the exclusive flag, which the operating system
// guarantees only one process can do (Windows, macOS and Linux alike). It holds
// the owner's pid, the time it was taken and a random token; nothing else.
//
// - A lock is stale when it is older than `staleMs` AND its process is gone. A
//   lock held by a live process is never taken away, however old: a gate run can
//   legitimately hold one for minutes.
// - Taking over a stale lock happens under a second, short-lived lock, and only
//   after checking that the lock is still the same stale one, so two waiters can
//   never both take it over.
// - After `timeoutMs` the waiter gives up with a message naming the holder.
// - Release removes the file only if it still holds the owner's token.

import { randomBytes } from 'node:crypto';
import { mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync, closeSync } from 'node:fs';
import path from 'node:path';
import { AsdkError } from './errors.mjs';

export const LOCK_TIMEOUT_MS = 10000;
export const LOCK_STALE_MS = 30000;

export class LockTimeoutError extends AsdkError {
  constructor(message) {
    super(message, 1);
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, but belongs to someone else
  }
}

// On Windows a file that is being deleted while another process still has it open
// keeps its name for a moment, and opening it fails with EPERM instead of EEXIST.
const BUSY = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);
const GONE = new Set(['ENOENT', 'EPERM', 'EACCES', 'EBUSY']);

/** Creates `file` exclusively with `content`; false if it exists (or is still being deleted). */
function createExclusive(file, content) {
  let fd;
  try {
    fd = openSync(file, 'wx');
  } catch (err) {
    if (BUSY.has(err.code)) return false;
    throw err;
  }
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  return true;
}

/** The current holder: { raw, pid, ts, ageMs }, or null when there is no lock file. */
function readHolder(file, now) {
  let raw;
  let mtimeMs;
  try {
    raw = readFileSync(file, 'utf8');
    mtimeMs = statSync(file).mtimeMs;
  } catch (err) {
    if (GONE.has(err.code)) return null; // released meanwhile, or being deleted
    throw err;
  }
  let info = {};
  try {
    info = JSON.parse(raw);
  } catch {
    // Written halfway by a process that died: judged by the file's age alone.
  }
  const taken = Date.parse(info.ts ?? '');
  return { raw, pid: info.pid, ts: info.ts, ageMs: now - (Number.isFinite(taken) ? taken : mtimeMs) };
}

const isStale = (holder, staleMs) => holder.ageMs > staleMs && !processAlive(holder.pid);

/** Removes `file` if it is still the stale lock `holder` described. Returns true when it was removed. */
function takeOverStale(file, holder, staleMs) {
  const guard = `${file}.takeover`;
  if (!createExclusive(guard, String(process.pid))) {
    // Another waiter is taking over. A guard left by a crash is cleared once it is old.
    try {
      if (Date.now() - statSync(guard).mtimeMs > staleMs) rmSync(guard, { force: true });
    } catch {
      // gone already
    }
    return false;
  }
  try {
    const again = readHolder(file, Date.now());
    if (!again || again.raw !== holder.raw || !isStale(again, staleMs)) return false;
    rmSync(file, { force: true });
    return true;
  } finally {
    rmSync(guard, { force: true });
  }
}

/**
 * Takes the lock at `file` and returns a function that releases it.
 * @param {{ timeoutMs?: number, staleMs?: number, label?: string }} [options]
 */
export function acquireLock(file, { timeoutMs = LOCK_TIMEOUT_MS, staleMs = LOCK_STALE_MS, label = path.basename(file) } = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  const token = randomBytes(8).toString('hex');
  const started = Date.now();
  let wait = 5;
  for (;;) {
    const content = JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), token });
    if (createExclusive(file, content)) {
      return () => {
        try {
          if (readFileSync(file, 'utf8') === content) rmSync(file, { force: true });
        } catch {
          // already gone
        }
      };
    }
    const holder = readHolder(file, Date.now());
    if (holder && isStale(holder, staleMs) && takeOverStale(file, holder, staleMs)) continue;
    if (Date.now() - started >= timeoutMs) {
      const who = holder?.pid ? `process ${holder.pid}${holder.ts ? ` since ${holder.ts}` : ''}` : 'another process';
      throw new LockTimeoutError(`${label} is locked by ${who}; gave up after ${Math.round(timeoutMs / 1000)} s. If no asdk command is running, delete ${file}`);
    }
    sleep(wait);
    wait = Math.min(wait * 2, 100);
  }
}

/** Runs the synchronous `fn` while holding the lock at `file`. */
export function withLock(file, fn, options) {
  const release = acquireLock(file, options);
  try {
    const result = fn();
    if (typeof result?.then === 'function') throw new TypeError('withLock needs a synchronous function; the lock would be released before it finished');
    return result;
  } finally {
    release();
  }
}
