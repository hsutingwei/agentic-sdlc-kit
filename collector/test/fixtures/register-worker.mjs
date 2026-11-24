// Registers `count` projects one after another, racing other workers on config.json.
// Usage: node register-worker.mjs <worker> <count> <base dir>
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { registerProject } from '../../lib/registry.mjs';

const [worker, count, base] = process.argv.slice(2);
for (let i = 0; i < Number(count); i++) {
  const root = path.join(base, `w${worker}-${i}`);
  mkdirSync(root, { recursive: true });
  registerProject(process.env, { id: `demo-w${worker}-${i}`, root });
}
