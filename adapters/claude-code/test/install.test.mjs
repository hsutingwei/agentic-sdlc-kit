import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, makeRepo, runAsdk } from '../../../test/helpers/sandbox.mjs';
import { insertChild } from '../../../core/json-text.mjs';
import { dataPath } from '../../../collector/lib/paths.mjs';
import { readEvents } from '../../../collector/lib/store.mjs';
import { HOOK_EVENTS, hookEntry, inspectHooks, installHooks, settingsTarget, uninstallHooks } from '../install.mjs';

const BOM = '\uFEFF';
const ENTRY = hookEntry({ platform: 'linux', execPath: '/usr/local/bin/node', asdk: '/opt/示範 kit/bin/asdk.mjs' });
const OTHER = hookEntry({ platform: 'linux', execPath: '/usr/local/bin/node', asdk: '/opt/舊的 kit/bin/asdk.mjs' });
const USER_HOOK = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo checked' }] };

// Settings files as users have them. CRLF and BOM are built here, not stored,
// because .gitattributes normalises line endings of checked-in files.
const FIXTURES = {
  'no file': null,
  'empty object': '{}\n',
  'Claude Code style': `{\n  "model": "sonnet",\n  "permissions": {\n    "deny": ["Bash(rm -rf:*)"]\n  },\n  "hooks": {\n    "PreToolUse": [\n      ${JSON.stringify(USER_HOOK)}\n    ],\n    "Stop": [ ]\n  }\n}\n`,
  'CRLF, four spaces': '{\r\n    "env": {\r\n        "說明": "中文 值"\r\n    }\r\n}\r\n',
  tabs: '{\n\t"hooks": {}\n}',
  'BOM, no final newline': `${BOM}{\n  "statusLine": { "type": "command", "command": "echo hi" }\n}`,
  compact: '{"model":"opus","hooks":{"SessionStart":[]}}',
};

function setup(t, label) {
  const sb = createSandbox(t, label);
  const file = settingsTarget(sb.env, { scope: 'user' }).file;
  return { sb, file, read: () => (existsSync(file) ? readFileSync(file, 'utf8') : null) };
}

function write(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const parse = (text) => JSON.parse(text.replace(/^\uFEFF/, ''));
const backups = (sb) => {
  const dir = dataPath(sb.env, 'backups', 'claude-settings');
  return existsSync(dir) ? readdirSync(dir) : [];
};

test('user scope follows CLAUDE_CONFIG_DIR, then ~/.claude', (t) => {
  const sb = createSandbox(t, 'inst-target');
  assert.equal(settingsTarget(sb.env).file, path.join(sb.home, '.claude', 'settings.json'));
  const { CLAUDE_CONFIG_DIR, ...rest } = sb.env;
  assert.ok(CLAUDE_CONFIG_DIR);
  assert.equal(settingsTarget(rest).file, path.join(sb.home, '.claude', 'settings.json'));
  assert.equal(settingsTarget({ ...rest, CLAUDE_CONFIG_DIR: sb.join('其他 設定') }).file, sb.join('其他 設定', 'settings.json'));
  assert.throws(() => settingsTarget(sb.env, { scope: 'project' }), /--scope must be one of/);
});

for (const [name, original] of Object.entries(FIXTURES)) {
  test(`install then uninstall restores the exact bytes: ${name}`, (t) => {
    const { sb, file, read } = setup(t, 'inst-exact');
    if (original !== null) write(file, original);

    const r = installHooks(sb.env, { entry: ENTRY });
    assert.deepEqual(r.added, HOOK_EVENTS);
    const installed = parse(read());
    for (const event of HOOK_EVENTS) assert.deepEqual(installed.hooks[event].at(-1), ENTRY, event);
    if (original !== null) {
      // Everything that was there is still there, unchanged.
      const before = parse(original);
      for (const [key, value] of Object.entries(before)) {
        if (key !== 'hooks') assert.deepEqual(installed[key], value, key);
      }
      for (const [event, list] of Object.entries(before.hooks ?? {})) assert.deepEqual(installed.hooks[event].slice(0, list.length), list);
      assert.equal(read().startsWith(BOM), original.startsWith(BOM));
      if (original.includes('\r\n')) assert.equal(read().replace(/\r\n/g, '').includes('\n'), false);
    }
    assert.deepEqual(inspectHooks(sb.env, { entry: ENTRY }).missing, []);

    const again = read();
    assert.equal(installHooks(sb.env, { entry: ENTRY }).changed, false);
    assert.equal(read(), again, 'a second install changes nothing');

    const u = uninstallHooks(sb.env, { entry: ENTRY });
    assert.equal(u.removed, HOOK_EVENTS.length);
    assert.equal(read(), original);
    assert.equal(existsSync(path.dirname(file)), true);
    assert.equal(uninstallHooks(sb.env, { entry: ENTRY }).changed, false);
  });
}

test('changes made after install survive uninstall', (t) => {
  const { sb, file, read } = setup(t, 'inst-edits');
  write(file, FIXTURES['Claude Code style']);
  installHooks(sb.env, { entry: ENTRY });

  // The user (or Claude Code) edits the file: a new setting and a hook of their own in an event the kit added.
  let text = insertChild(read(), [], { key: 'theme', value: 'dark' }).text;
  text = insertChild(text, ['hooks', 'SessionEnd'], { value: USER_HOOK }).text;
  write(file, text);

  uninstallHooks(sb.env, { entry: ENTRY });
  const after = parse(read());
  assert.equal(after.theme, 'dark');
  assert.deepEqual(after.hooks.SessionEnd, [USER_HOOK]);
  assert.deepEqual(after.hooks.PreToolUse, [USER_HOOK]);
  assert.deepEqual(after.hooks.Stop, []);
  assert.equal(JSON.stringify(after).includes('asdk.mjs'), false);
  assert.deepEqual(Object.keys(after.hooks).sort(), ['PreToolUse', 'SessionEnd', 'Stop']);
});

test('every write is preceded by a backup of the previous bytes, and recorded', (t) => {
  const { sb, file } = setup(t, 'inst-backup');
  const original = FIXTURES['CRLF, four spaces'];
  write(file, original);
  installHooks(sb.env, { entry: ENTRY });
  const [first] = backups(sb);
  assert.equal(readFileSync(path.join(dataPath(sb.env, 'backups', 'claude-settings'), first), 'utf8'), original);
  uninstallHooks(sb.env, { entry: ENTRY });
  assert.equal(backups(sb).length, 2);
  assert.deepEqual(
    readEvents(sb.env).events.map((e) => e.event),
    ['hooks.install', 'hooks.uninstall'],
  );
});

test('files that are not settings-shaped strict JSON are refused untouched', (t) => {
  const { sb, file, read } = setup(t, 'inst-refuse');
  const bad = {
    comments: '{\n  // mine\n  "model": "sonnet"\n}\n',
    'trailing comma': '{ "model": "sonnet", }',
    'hooks is an array': '{ "hooks": [] }',
    'event is an object': '{ "hooks": { "Stop": {} } }',
    'top level array': '[]',
  };
  for (const [name, text] of Object.entries(bad)) {
    write(file, text);
    assert.throws(() => installHooks(sb.env, { entry: ENTRY }), (err) => err.exitCode === 2, name);
    assert.throws(() => uninstallHooks(sb.env, { entry: ENTRY }), (err) => err.exitCode === 2, name);
    assert.equal(read(), text, name);
    assert.match(inspectHooks(sb.env, { entry: ENTRY }).error, /not changing it/, name);
  }
  writeFileSync(file, Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])); // {"\xff":1}
  assert.throws(() => installHooks(sb.env, { entry: ENTRY }), /not UTF-8/);
  assert.deepEqual(backups(sb), []);
});

test('a file changed during the edit is not overwritten', (t) => {
  const { sb, file, read } = setup(t, 'inst-race');
  write(file, '{}\n');
  const theirs = '{\n  "model": "haiku"\n}\n';
  assert.throws(() => installHooks(sb.env, { entry: ENTRY, beforeWrite: () => writeFileSync(file, theirs) }), /changed while it was being edited/);
  assert.equal(read(), theirs);
  assert.equal(inspectHooks(sb.env, { entry: ENTRY }).installed.length, 0);
});

test('a moved kit: old entries are reported, and uninstall removes both', (t) => {
  const { sb, file, read } = setup(t, 'inst-moved');
  const original = FIXTURES['Claude Code style'];
  write(file, original);
  installHooks(sb.env, { entry: OTHER });
  const r = installHooks(sb.env, { entry: ENTRY });
  assert.equal(r.stale, HOOK_EVENTS.length);
  assert.equal(inspectHooks(sb.env, { entry: ENTRY }).stale, HOOK_EVENTS.length);
  uninstallHooks(sb.env, { entry: ENTRY });
  assert.equal(read(), original);
});

test('without an install record, --all still removes kit entries', (t) => {
  const { sb, file, read } = setup(t, 'inst-all');
  const hooks = Object.fromEntries(['Stop', 'SessionEnd'].map((e) => [e, [OTHER, USER_HOOK]]));
  write(file, `${JSON.stringify({ hooks }, null, 2)}\n`);
  assert.equal(uninstallHooks(sb.env, { entry: ENTRY }).changed, false);
  const r = uninstallHooks(sb.env, { entry: ENTRY, all: true });
  assert.equal(r.removed, 2);
  assert.deepEqual(parse(read()).hooks, { Stop: [USER_HOOK], SessionEnd: [USER_HOOK] });
});

test('dry runs report without writing', (t) => {
  const { sb, file, read } = setup(t, 'inst-dry');
  write(file, '{}\n');
  assert.equal(installHooks(sb.env, { entry: ENTRY, dryRun: true }).added.length, HOOK_EVENTS.length);
  assert.equal(read(), '{}\n');
  assert.deepEqual(backups(sb), []);
});

test('local scope writes the project settings.local.json, in a CJK path', (t) => {
  const sb = createSandbox(t, 'inst-local');
  const root = makeRepo(sb, sb.join('示範 專案'));
  const { file } = settingsTarget(sb.env, { scope: 'local', cwd: path.join(root) });
  assert.equal(file, path.join(root, '.claude', 'settings.local.json'));
  installHooks(sb.env, { scope: 'local', project: root, entry: ENTRY });
  assert.deepEqual(parse(readFileSync(file, 'utf8')).hooks.Stop, [ENTRY]);
  assert.equal(uninstallHooks(sb.env, { scope: 'local', project: root, entry: ENTRY }).deletedFile, true);
  assert.equal(existsSync(file), false);
  assert.throws(() => settingsTarget(sb.env, { scope: 'local', cwd: sb.home }), /--project/);
});

test('hook commands: absolute node, Git Bash quoting, PowerShell fallback', () => {
  const linux = hookEntry({ platform: 'linux', execPath: '/usr/bin/node', asdk: '/home/dev/工具 kit/bin/asdk.mjs' });
  assert.deepEqual(linux, { matcher: '*', hooks: [{ type: 'command', command: '"/usr/bin/node" "/home/dev/工具 kit/bin/asdk.mjs" hook', timeout: 10 }] });
  assert.throws(() => hookEntry({ platform: 'linux', execPath: '/usr/bin/node', asdk: '/home/dev/$kit/asdk.mjs' }), /cannot quote/);

  const win = { platform: 'win32', execPath: 'C:\\Program Files\\nodejs\\node.exe', asdk: "C:\\work\\Dev's kit\\bin\\asdk.mjs" };
  const noBash = hookEntry({ ...win, env: { PATH: '' } });
  assert.equal(noBash.hooks[0].command, "& 'C:/Program Files/nodejs/node.exe' 'C:/work/Dev''s kit/bin/asdk.mjs' hook");
  assert.equal(noBash.hooks[0].shell, 'powershell');
});

test('asdk hooks install, status and uninstall', (t) => {
  const { sb, file, read } = setup(t, 'inst-cli');
  const original = FIXTURES['BOM, no final newline'];
  write(file, original);

  assert.equal(runAsdk(sb, ['hooks', 'status']).status, 1);
  let r = runAsdk(sb, ['hooks', 'install']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /added 9 hook event\(s\)/);
  r = runAsdk(sb, ['hooks', 'status', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).missing, []);
  assert.match(runAsdk(sb, ['hooks', 'install']).stdout, /already installed/);
  r = runAsdk(sb, ['hooks', 'uninstall']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(), original);
  assert.equal(runAsdk(sb, ['hooks', 'install', '--scope', 'nope']).status, 2);
});
