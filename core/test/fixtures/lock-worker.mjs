// Takes a lock, holds it briefly and logs when it entered and left.
// Usage: node lock-worker.mjs <lock file> <log file> <hold ms> <rounds>
import { appendFileSync } from 'node:fs';
import { withLock } from '../../lock.mjs';

const [lock, log, hold, rounds] = process.argv.slice(2);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
for (let i = 0; i < Number(rounds); i++) {
  withLock(lock, () => {
    appendFileSync(log, `enter ${process.pid} ${performance.timeOrigin + performance.now()}\n`);
    sleep(Number(hold));
    appendFileSync(log, `exit ${process.pid} ${performance.timeOrigin + performance.now()}\n`);
  }, { timeoutMs: 30000 });
}
