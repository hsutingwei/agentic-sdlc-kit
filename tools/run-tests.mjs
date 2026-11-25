#!/usr/bin/env node
// Collects every *.test.mjs file and runs them with the built-in node:test runner.
//
// Building the list here instead of relying on `node --test` discovery keeps three
// things explicit: which directories are skipped (examples/ and fixtures/ hold files
// that are not part of this suite), the same order on every platform, and a failure
// when nothing matched, so an empty run never looks like a passing one.
//
// Usage: node tools/run-tests.mjs [path-substring ...]
//   With arguments, only test files whose repo-relative path contains one of them run.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// examples/ holds sample projects that run their own tests through the gates.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'fixtures', 'examples', 'coverage']);
// The E1 task catalogue holds hidden tests and reference solutions as data; its own
// test (test/experiment-tasks.test.mjs) runs them inside throw-away demo repositories.
const SKIP_PATHS = new Set([path.join(ROOT, 'tools', 'experiment', 'tasks'), path.join(ROOT, 'skill-regression', 'cases')]);
const TEST_FILE = /\.test\.mjs$/;

function findTestFiles(dir, found = []) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !SKIP_PATHS.has(full)) findTestFiles(full, found);
    } else if (entry.isFile() && TEST_FILE.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

const toRepoPath = (file) => path.relative(ROOT, file).split(path.sep).join('/');

const filters = process.argv.slice(2);
const files = findTestFiles(ROOT)
  .map(toRepoPath)
  .filter((rel) => filters.length === 0 || filters.some((f) => rel.includes(f)));

if (files.length === 0) {
  // An empty run must not look like a passing one.
  console.error('run-tests: no test files matched');
  process.exit(1);
}

// On GitHub Actions, also emit failures as annotations (readable without signing in).
const reporters =
  process.env.GITHUB_ACTIONS === 'true'
    ? [
        '--test-reporter=spec',
        '--test-reporter-destination=stdout',
        `--test-reporter=${pathToFileURL(path.join(ROOT, 'tools', 'gha-reporter.mjs')).href}`,
        '--test-reporter-destination=stdout',
      ]
    : [];

const result = spawnSync(process.execPath, ['--test', ...reporters, ...files], { cwd: ROOT, stdio: 'inherit' });
if (result.error) {
  console.error(`run-tests: could not start node: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
