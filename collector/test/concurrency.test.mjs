import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSandbox } from '../../test/helpers/sandbox.mjs';
import { readEvents } from '../lib/store.mjs';

const WORKER = fileURLToPath(new URL('./fixtures/append-worker.mjs', import.meta.url));
const WORKERS = 8;
const PER_WORKER = 50;

test('parallel processes appending to one session file never tear a line', async (t) => {
  const sb = createSandbox(t, 'append-race');
  // A sub-agent's hook calls share the parent's session id, so they write the same file.
  await Promise.all(
    Array.from({ length: WORKERS }, (_, w) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [WORKER, String(w), String(PER_WORKER), 'shared-session'], { env: sb.env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (d) => {
          stderr += d;
        });
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${w} exited ${code}: ${stderr}`))));
      }),
    ),
  );

  const { events, invalid } = readEvents(sb.env);
  assert.equal(invalid, 0);
  assert.equal(events.length, WORKERS * PER_WORKER);
  for (let w = 0; w < WORKERS; w++) {
    const seqs = events.filter((e) => e.data.worker === w).map((e) => e.data.seq).sort((a, b) => a - b);
    assert.deepEqual(seqs, Array.from({ length: PER_WORKER }, (_, i) => i), `worker ${w}`);
  }
});
