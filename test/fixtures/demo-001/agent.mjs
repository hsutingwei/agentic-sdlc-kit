// Scripted stand-in for the implementer sub-agent in the end-to-end test.
//
//   node agent.mjs <worktree> attempt-1   src + new tests, but forgets that the
//                                         existing tests expect items without due_date
//   node agent.mjs <worktree> attempt-2   updates the existing tests
//
// Each attempt commits, like the real implementer is told to.

import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [worktree, attempt] = process.argv.slice(2);
const git = (...args) => execFileSync('git', args, { cwd: worktree, stdio: 'pipe' });

if (attempt === 'attempt-1') {
  copyFileSync(path.join(here, 'src', 'todos.mjs'), path.join(worktree, 'src', 'todos.mjs'));
  copyFileSync(path.join(here, 'test', 'unit', 'due-date.test.mjs'), path.join(worktree, 'test', 'unit', 'due-date.test.mjs'));
  const server = path.join(worktree, 'src', 'server.mjs');
  const before = readFileSync(server, 'utf8');
  const after = before.replace(
    "if (req.method === 'GET') return send(res, 200, store.list());",
    "if (req.method === 'GET') return send(res, 200, store.list({ overdue: url.searchParams.get('overdue') === 'true' }));",
  );
  if (after === before) throw new Error('server.mjs did not contain the expected list route');
  writeFileSync(server, after);
  git('add', '.');
  git('commit', '-q', '-m', 'feat: Add due dates to todo items (DEMO-001)');
} else if (attempt === 'attempt-2') {
  const file = path.join(worktree, 'test', 'unit', 'todos.test.mjs');
  writeFileSync(file, readFileSync(file, 'utf8').replace(/done: (true|false) \}/g, 'done: $1, due_date: null }'));
  git('add', '.');
  git('commit', '-q', '-m', 'test: expect due_date null on existing items (DEMO-001)');
} else {
  throw new Error('usage: node agent.mjs <worktree> attempt-1|attempt-2');
}
