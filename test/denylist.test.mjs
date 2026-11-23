import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox, git, run, runNode } from './helpers/sandbox.mjs';
import { defaultDenylistPath, DenylistError, isInside, matchRule, parseDenylist } from '../tools/lib/denylist.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO_ROOT, 'tools', 'check-denylist.mjs');
const HOOKS_DIR = path.join(REPO_ROOT, 'tools', 'hooks');

// Fictional rules only. Line numbers matter: hits are reported by rule line.
const RULES = [
  '# fictional rules for tests', // 1
  'acme-secret', //                  2
  '機密代號', //                      3
  're:\\bEMP[0-9]{6}\\b', //          4
  'warn:re:\\bwidget-flux\\b', //     5
  '',
].join('\n');

function setup(t, label) {
  const sb = createSandbox(t, label);
  const repo = sb.join('示範 專案');
  mkdirSync(repo);
  git(sb, repo, 'init', '-q');
  const list = defaultDenylistPath(sb.home);
  mkdirSync(path.dirname(list), { recursive: true });
  writeFileSync(list, RULES);
  const write = (rel, content) => {
    const file = path.join(repo, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const check = (args = [], env = sb.env) => runNode(CLI, args, { cwd: repo, env });
  return { sb, repo, list, write, check };
}

test('parseDenylist reads levels, kinds and line numbers; skips BOM, CRLF, comments, blanks, duplicates', () => {
  const text = '\uFEFF# names\r\n acme-secret \r\n\r\nre:\\bEMP\\d+\r\nWARN: widget\r\nwarn:re:^x$\r\nACME-SECRET\n';
  const rules = parseDenylist(text);
  assert.deepEqual(
    rules.map(({ line, level, kind }) => ({ line, level, kind })),
    [
      { line: 2, level: 'block', kind: 'text' },
      { line: 4, level: 'block', kind: 'regex' },
      { line: 5, level: 'warn', kind: 'text' },
      { line: 6, level: 'warn', kind: 'regex' },
    ],
  );
});

test('parseDenylist rejects bad regular expressions without echoing them', () => {
  assert.throws(() => parseDenylist('ok\nre:(unclosed\n'), (err) => err instanceof DenylistError && /line 2: invalid/.test(err.message) && !err.message.includes('unclosed'));
  assert.throws(() => parseDenylist('re:x*\n'), /matches empty text/);
  assert.throws(() => parseDenylist('warn:\n'), /line 1: empty rule/);
});

test('isInside handles case, separators and sibling prefixes', () => {
  assert.equal(isInside('C:\\Work\\Repo\\a.txt', 'c:/work/repo', 'win32'), true);
  assert.equal(isInside('C:\\Work\\Repo', 'C:\\Work\\Repo', 'win32'), true);
  assert.equal(isInside('C:\\Work\\Repo-other\\a', 'C:\\Work\\Repo', 'win32'), false);
  assert.equal(isInside('D:\\Work\\Repo', 'C:\\Work\\Repo', 'win32'), false);
  assert.equal(isInside('/home/dev/demo-api/x', '/home/dev/demo-api', 'linux'), true);
  assert.equal(isInside('/home/dev/Demo-API/x', '/home/dev/demo-api', 'linux'), false);
  assert.equal(isInside('/home/dev/..demo', '/home/dev/demo', 'linux'), false);
});

test('matchRule prefers block rules, is case-insensitive, and respects regex word boundaries', () => {
  const rules = parseDenylist(RULES);
  assert.equal(matchRule('x ACME-Secret y', rules).line, 2);
  assert.equal(matchRule('內含機密代號', rules).line, 3);
  assert.equal(matchRule('owner emp123456', rules).line, 4);
  assert.equal(matchRule('TEMP1234567', rules), null);
  assert.equal(matchRule('widget-flux and acme-secret', rules).line, 2);
  assert.equal(matchRule('a widget-flux b', rules).level, 'warn');
  assert.equal(matchRule('clean', rules), null);
});

test('clean staged files pass', (t) => {
  const { sb, repo, write, check } = setup(t, 'clean');
  write('src/app.js', 'export const name = "demo-api";\n');
  git(sb, repo, 'add', '.');
  const r = check();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
});

test('a text match blocks and does not print the keyword', (t) => {
  const { sb, repo, write, check } = setup(t, 'content');
  write('src/app.js', 'const a = 1;\nconst host = "ACME-Secret.example";\n');
  git(sb, repo, 'add', '.');
  const r = check();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /src\/app\.js:2 {2}\(rule at line 2\)/);
  assert.doesNotMatch(r.stderr.toLowerCase(), /acme-secret/);
});

test('a regex match blocks', (t) => {
  const { sb, repo, write, check } = setup(t, 'regex');
  write('notes.md', 'reviewed by EMP004211\r\n');
  git(sb, repo, 'add', '.');
  const r = check();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /notes\.md:1 {2}\(rule at line 4\)/);
});

test('warn rules print a warning and allow the commit', (t) => {
  const { sb, repo, write, check } = setup(t, 'warn');
  write('docs/a.md', 'the widget-flux module\n');
  git(sb, repo, 'add', '.');
  const r = check();
  assert.equal(r.status, 0);
  assert.match(r.stderr, /warning/);
  assert.match(r.stderr, /docs\/a\.md:1 {2}\(warn rule at line 5\)/);
});

test('a CJK keyword in a file with a CJK name is reported with the name unescaped', (t) => {
  const { sb, repo, write, check } = setup(t, 'cjk');
  write('筆記 檔案.md', '第一行\n這裡有機密代號\n');
  git(sb, repo, 'add', '.');
  const r = check();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /筆記 檔案\.md:2 {2}\(rule at line 3\)/);
  assert.doesNotMatch(r.stderr, /這裡有/);
});

test('a keyword in a staged file name blocks', (t) => {
  const { sb, repo, write, check } = setup(t, 'name');
  write('docs/acme-secret-notes.txt', 'nothing here\n');
  git(sb, repo, 'add', '.');
  const r = check();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\(file name, rule at line 2\)/);
});

test('a denied author or committer identity blocks without printing it', (t) => {
  const { sb, repo, write, check } = setup(t, 'ident');
  write('a.txt', 'clean\n');
  git(sb, repo, 'add', '.');
  const author = check([], { ...sb.env, GIT_AUTHOR_NAME: 'Acme-Secret Bot' });
  assert.equal(author.status, 1);
  assert.match(author.stderr, /commit author name or email {2}\(rule at line 2\)/);
  assert.doesNotMatch(author.stderr.toLowerCase(), /acme-secret/);

  const committer = check([], { ...sb.env, GIT_COMMITTER_EMAIL: 'emp123456@example.invalid' });
  assert.equal(committer.status, 1);
  assert.match(committer.stderr, /commit committer name or email {2}\(rule at line 4\)/);

  // --tracked looks at files only; identities belong to a commit.
  assert.equal(check(['--tracked'], { ...sb.env, GIT_AUTHOR_NAME: 'Acme-Secret Bot' }).status, 0);
});

test('binary files are skipped', (t) => {
  const { sb, repo, write, check } = setup(t, 'binary');
  write('logo.bin', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('acme-secret')]));
  git(sb, repo, 'add', '.');
  assert.equal(check().status, 0);
});

test('only the index is scanned in staged mode; --tracked scans the working tree', (t) => {
  const { sb, repo, write, check } = setup(t, 'modes');
  write('a.txt', 'clean\n');
  git(sb, repo, 'add', '.');
  write('a.txt', 'clean\nacme-secret\n');
  assert.equal(check().status, 0);
  assert.equal(check(['--tracked']).status, 1);
});

test('a missing list blocks with setup instructions', (t) => {
  const { sb, repo, check } = setup(t, 'missing');
  const env = { ...sb.env, AGENTIC_SDLC_DENYLIST: path.join(sb.home, 'nope.txt') };
  writeFileSync(path.join(repo, 'a.txt'), 'x\n');
  git(sb, repo, 'add', '.');
  const r = check([], env);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /AGENTIC_SDLC_DENYLIST=none/);
});

test('a list without blocking rules blocks', (t) => {
  const { list, check } = setup(t, 'empty');
  writeFileSync(list, '# nothing yet\n\nwarn:only-a-warning\n');
  const r = check();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no blocking rules/);
});

test('an invalid regex in the list is a configuration error', (t) => {
  const { list, check } = setup(t, 'badre');
  writeFileSync(list, 'acme-secret\nre:[oops\n');
  const r = check();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /line 2: invalid regular expression/);
});

test('AGENTIC_SDLC_DENYLIST=none skips the check on purpose', (t) => {
  const { sb, repo, write, check } = setup(t, 'none');
  write('a.txt', 'acme-secret\n');
  git(sb, repo, 'add', '.');
  const r = check([], { ...sb.env, AGENTIC_SDLC_DENYLIST: 'none' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /skipped/);
});

test('a list stored inside the repository is refused', (t) => {
  const { sb, repo, write, check } = setup(t, 'inside');
  write('denylist.txt', 'acme-secret\n');
  const r = check([], { ...sb.env, AGENTIC_SDLC_DENYLIST: path.join(repo, 'denylist.txt') });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /outside the repository/);
});

test('unknown arguments are a usage error', (t) => {
  const { check } = setup(t, 'usage');
  assert.equal(check(['--everything']).status, 2);
});

test('the pre-commit hook blocks a matching commit and allows a clean one', (t) => {
  const { sb, repo, write } = setup(t, 'hook');
  git(sb, repo, 'config', 'core.hooksPath', HOOKS_DIR.split(path.sep).join('/'));

  write('a.txt', 'acme-secret\n');
  git(sb, repo, 'add', '.');
  const blocked = run('git', ['commit', '-q', '-m', 'test: blocked'], { cwd: repo, env: sb.env });
  assert.notEqual(blocked.status, 0, 'commit should have been blocked');
  assert.match(blocked.stderr, /check-denylist: blocked/);
  assert.notEqual(run('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: repo, env: sb.env }).status, 0);

  write('a.txt', 'clean\n');
  git(sb, repo, 'add', '.');
  const allowed = run('git', ['commit', '-q', '-m', 'test: allowed'], { cwd: repo, env: sb.env });
  assert.equal(allowed.status, 0, allowed.stderr);
});
