// Stands in for `claude -p` in the E1 runner tests: reads the brief named in the
// prompt, changes the worktree like an agent would, commits, and prints
// stream-json lines shaped like Claude Code's.
//
// FAKE_CLAUDE_MODE:
//   solve           apply the task's reference solution
//   break-then-fix  first attempt breaks a unit test; the retry applies the solution
//   break           every attempt breaks a unit test
//   shallow         a change the gates accept but the hidden tests do not

import { execFileSync } from 'node:child_process';
import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyOverlay, loadTask } from '../../tools/experiment/lib/catalogue.mjs';

const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] ?? '';
const id = /briefs\/(DEMO-\d+)\.json/.exec(prompt)?.[1];
const retry = prompt.startsWith('wt finish did not merge');
const mode = process.env.FAKE_CLAUDE_MODE ?? 'solve';
const cwd = process.cwd();
const git = (...a) => execFileSync('git', a, { cwd, stdio: 'pipe' });
const broken = path.join(cwd, 'test', 'unit', 'broken.test.mjs');

if (mode === 'shallow') {
  appendFileSync(path.join(cwd, 'src', 'todos.mjs'), '// looked at the task\n');
} else if (mode === 'break' || (mode === 'break-then-fix' && !retry)) {
  writeFileSync(broken, "import { test } from 'node:test';\ntest('x', () => { throw new Error('not yet'); });\n");
} else {
  rmSync(broken, { force: true });
  applyOverlay(loadTask(id).solution, cwd);
}
git('add', '-A');
git('commit', '-q', '-m', `feat: ${id}${retry ? ' (retry)' : ''}`);

const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'unknown';
const out = [
  { type: 'system', subtype: 'init', model },
  { type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.42, resetsAt: 1795000000 }, seven_day: { utilization: 0.1, resetsAt: 1795500000 } } } },
  { type: 'result', subtype: 'success', is_error: false, num_turns: 2, duration_ms: 1234, total_cost_usd: 0.01, modelUsage: { [model]: {} } },
];
for (const line of out) process.stdout.write(`${JSON.stringify(line)}\n`);
