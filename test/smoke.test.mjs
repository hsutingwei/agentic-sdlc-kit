import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, git, runNode } from './helpers/sandbox.mjs';

test('runs on Node.js 22 or newer', () => {
  const major = Number(process.versions.node.split('.')[0]);
  assert.ok(major >= 22, `Node ${process.versions.node} is older than 22`);
});

test('sandbox paths contain CJK characters and spaces', (t) => {
  const sb = createSandbox(t, 'paths');
  assert.match(sb.root, /測試/);
  assert.match(sb.root, / /);
  assert.match(sb.home, /家目錄/);
});

test('files with CJK names round-trip as UTF-8', (t) => {
  const sb = createSandbox(t, 'utf8');
  const dir = sb.join('資料 夾');
  mkdirSync(dir);
  const file = path.join(dir, '待辦 清單.txt');
  writeFileSync(file, '完成 DEMO-001\n', 'utf8');
  assert.equal(readFileSync(file, 'utf8'), '完成 DEMO-001\n');
  assert.deepEqual(readdirSync(dir), ['待辦 清單.txt']);
});

test('child processes see the sandbox home, not the real one', (t) => {
  const sb = createSandbox(t, 'env');
  const cwd = sb.join('工作 目錄');
  mkdirSync(cwd);
  const script = sb.join('probe.mjs');
  writeFileSync(
    script,
    [
      "import os from 'node:os';",
      'console.log(JSON.stringify({',
      '  home: os.homedir(),',
      '  cwd: process.cwd(),',
      '  metrics: process.env.AGENTIC_METRICS_HOME,',
      '  claude: process.env.CLAUDE_CONFIG_DIR,',
      '}));',
    ].join('\n'),
  );
  const result = runNode(script, [], { cwd, env: sb.env });
  assert.equal(result.status, 0, result.stderr);
  const seen = JSON.parse(result.stdout);
  assert.equal(seen.home, sb.home);
  assert.equal(seen.cwd, cwd);
  assert.equal(seen.metrics, path.join(sb.home, '.agentic-metrics'));
  assert.equal(seen.claude, path.join(sb.home, '.claude'));
});

test('git in the sandbox uses the sandbox identity and branch', (t) => {
  const sb = createSandbox(t, 'git');
  const repo = sb.join('示範 專案');
  mkdirSync(repo);
  git(sb, repo, 'init', '-q');
  writeFileSync(path.join(repo, '說明.md'), '# demo-api\n');
  git(sb, repo, 'add', '.');
  git(sb, repo, 'commit', '-q', '-m', 'chore: initial commit');
  assert.equal(git(sb, repo, 'log', '-1', '--format=%ae').trim(), 'dev@example.invalid');
  assert.equal(git(sb, repo, 'branch', '--show-current').trim(), 'main');
});
