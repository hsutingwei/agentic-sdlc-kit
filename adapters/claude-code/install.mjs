// `asdk hooks install|uninstall|status`: adds the kit's hook to Claude Code
// settings and takes it out again without disturbing anything else.
//
// - Edits are made on the file's text (core/json-text.mjs), so indentation, key
//   order, line endings and a BOM survive. Install followed by uninstall gives the
//   original bytes back; content the user added in between stays.
// - A manifest under state/ records what install created (the file, the "hooks"
//   member, event members) and the whitespace of containers that were empty, so
//   uninstall can remove exactly that.
// - Before every write the current bytes go to backups/claude-settings/. The file
//   is re-read just before the write; if it changed meanwhile the edit is dropped.
// - Files that are not strict JSON, not UTF-8, or not shaped like settings are
//   refused, never rewritten.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsdkError, usageError } from '../../core/errors.mjs';
import { locateRepo } from '../../core/git.mjs';
import { childValues, insertChild, JsonTextError, nodeAt, parseJsonText, removeChild } from '../../core/json-text.mjs';
import { withCollectorLock } from '../../collector/lib/locks.mjs';
import { dataPath, homeDir } from '../../collector/lib/paths.mjs';
import { appendEvent, makeEvent } from '../../collector/lib/store.mjs';

export const ASDK_BIN = fileURLToPath(new URL('../../bin/asdk.mjs', import.meta.url));

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'SessionEnd',
];

/** Seconds Claude Code waits for the hook (its default is 600). The hook itself gives up on stdin after 5. */
export const HOOK_TIMEOUT_SECONDS = 10;

export const SCOPES = ['user', 'local'];

// Recognises a kit hook from any checkout, for status and `uninstall --all`.
const ASDK_COMMAND = /asdk\.mjs["']?\s+hook\s*$/;

const slash = (p) => p.split(path.sep).join('/');
// Windows paths written into a hook command, also when the command is built for Windows elsewhere (tests).
const winSlash = (p) => p.replace(/\\/g, '/');

/** Git Bash runs hook commands on Windows when it is installed (docs/spike, finding 10). */
export function findGitBash(env = process.env) {
  const candidates = [env.CLAUDE_CODE_GIT_BASH_PATH];
  for (const root of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')]) {
    if (root) candidates.push(path.join(root, 'Git', 'bin', 'bash.exe'));
  }
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, 'git.exe'))) candidates.push(path.join(dir, '..', 'bin', 'bash.exe'));
  }
  return candidates.find((c) => c && existsSync(c)) ?? null;
}

/**
 * The hook entry for this kit checkout. The node path is absolute: the PATH that
 * Claude Code gives hooks may not contain node.
 */
export function hookEntry({ env = process.env, platform = process.platform, execPath = process.execPath, asdk = ASDK_BIN } = {}) {
  const node = platform === 'win32' ? winSlash(execPath) : execPath;
  const script = platform === 'win32' ? winSlash(asdk) : asdk;
  const hook = { type: 'command', command: '', timeout: HOOK_TIMEOUT_SECONDS };
  if (platform === 'win32' && !findGitBash(env)) {
    // Without Git Bash Claude Code uses PowerShell, where a quoted path needs the call operator.
    const q = (p) => `'${p.replace(/'/g, "''")}'`;
    hook.command = `& ${q(node)} ${q(script)} hook`;
    hook.shell = 'powershell';
  } else {
    // Inside double quotes bash still expands $ and `, and treats \ as an escape.
    const unsafe = platform === 'win32' ? /["$`]/ : /["$`\\]/;
    for (const p of [node, script]) {
      if (unsafe.test(p)) throw usageError(`cannot quote this path for a hook command: ${p}`);
    }
    hook.command = `"${node}" "${script}" hook`;
  }
  return { matcher: '*', hooks: [hook] };
}

export function settingsTarget(env, { scope = 'user', project, cwd = process.cwd() } = {}) {
  if (!SCOPES.includes(scope)) throw usageError(`--scope must be one of: ${SCOPES.join(', ')}`);
  if (scope === 'user') {
    const configDir = env.CLAUDE_CONFIG_DIR?.trim();
    return { scope, file: path.join(configDir ? path.resolve(configDir) : path.join(homeDir(env), '.claude'), 'settings.json') };
  }
  const root = project ? path.resolve(cwd, project) : locateRepo(cwd)?.toplevel;
  if (!root || !existsSync(root)) throw usageError('--scope local needs --project <dir> or a working directory inside a git repository');
  return { scope, file: path.join(root, '.claude', 'settings.local.json') };
}

const manifestFile = (env, file) =>
  dataPath(env, 'state', 'claude-hooks', `${createHash('sha256').update(slash(path.resolve(file)).toLowerCase()).digest('hex').slice(0, 16)}.json`);

function readManifest(env, file) {
  const m = manifestFile(env, file);
  if (!existsSync(m)) return null;
  try {
    return JSON.parse(readFileSync(m, 'utf8'));
  } catch {
    throw new AsdkError(`${m} is damaged; remove it to continue (uninstall then leaves empty containers in place)`, 2);
  }
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Reads a settings file: null when absent; refuses anything that is not UTF-8 strict JSON shaped like settings. */
function readSettings(file) {
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new AsdkError(`${file} is not UTF-8; not changing it`, 2);
  try {
    if (parseJsonText(text).root.type !== 'object') throw new JsonTextError('the top level is not an object');
  } catch (err) {
    if (err instanceof JsonTextError) throw new AsdkError(`${file} is not strict JSON (${err.message}); not changing it`, 2);
    throw err;
  }
  const hooks = nodeAt(text, ['hooks']);
  if (hooks && hooks.type !== 'object') throw new AsdkError(`${file}: "hooks" is not an object; not changing it`, 2);
  for (const { key, value } of hooks ? childValues(text, ['hooks']) : []) {
    if (!Array.isArray(value)) throw new AsdkError(`${file}: "hooks.${key}" is not an array; not changing it`, 2);
  }
  return { bytes, text };
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Backs up the current bytes, then replaces the file only if nobody changed it since `before` was read. */
function commit(env, file, before, afterText, scope, beforeWrite) {
  const now = new Date();
  if (before) {
    const backup = dataPath(env, 'backups', 'claude-settings', `${now.toISOString().replace(/[:.]/g, '-')}-${scope}-${path.basename(file)}`);
    mkdirSync(path.dirname(backup), { recursive: true });
    writeFileSync(backup, before.bytes);
  }
  beforeWrite?.(); // test seam: lets a test change the file at the worst moment
  const current = existsSync(file) ? readFileSync(file) : null;
  const unchanged = before ? current?.equals(before.bytes) : current === null;
  if (!unchanged) throw new AsdkError(`${file} changed while it was being edited; nothing was written, run the command again`, 1);

  if (afterText === null) {
    rmSync(file);
    return backupNote(before);
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.asdk-${process.pid}.tmp`;
  writeFileSync(tmp, afterText);
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);
      break;
    } catch (err) {
      // Windows refuses the rename while another process has the file open.
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        rmSync(tmp, { force: true });
        throw err;
      }
      sleep(50 * (attempt + 1));
    }
  }
  return backupNote(before);
}

const backupNote = (before) => (before ? 'backup saved' : 'no previous file');

const isOurs = (entry, commands) => Array.isArray(entry?.hooks) && entry.hooks.length === 1 && commands.includes(entry.hooks[0]?.command);
const isAnyAsdk = (entry) => Array.isArray(entry?.hooks) && entry.hooks.some((h) => typeof h?.command === 'string' && ASDK_COMMAND.test(h.command));

export function installHooks(env, options = {}) {
  return withCollectorLock(env, 'claude-settings', () => installLocked(env, options));
}

function installLocked(env, { scope = 'user', project, cwd, dryRun = false, entry = hookEntry({ env }), beforeWrite } = {}) {
  const { file } = settingsTarget(env, { scope, project, cwd });
  const before = readSettings(file);
  const manifest = readManifest(env, file);
  const command = entry.hooks[0].command;
  const created = new Set(manifest?.created ?? []);
  const emptyInner = { ...(manifest?.empty_inner ?? {}) };
  const keepFirst = (key, value) => {
    if (value !== undefined && !(key in emptyInner)) emptyInner[key] = value;
  };

  let text;
  let createdFile = manifest?.created_file ?? false;
  const added = [];
  if (!before) {
    text = `${JSON.stringify({ hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [entry]])) }, null, 2)}\n`;
    createdFile = true;
    added.push(...HOOK_EVENTS);
    created.add('hooks');
    for (const e of HOOK_EVENTS) created.add(`hooks.${e}`);
  } else {
    text = before.text;
    if (!nodeAt(text, ['hooks'])) {
      const r = insertChild(text, [], { key: 'hooks', value: Object.fromEntries(HOOK_EVENTS.map((e) => [e, [entry]])) });
      text = r.text;
      keepFirst('', r.emptyInner);
      created.add('hooks');
      for (const e of HOOK_EVENTS) created.add(`hooks.${e}`);
      added.push(...HOOK_EVENTS);
    } else {
      for (const event of HOOK_EVENTS) {
        const list = nodeAt(text, ['hooks', event]);
        if (!list) {
          const r = insertChild(text, ['hooks'], { key: event, value: [entry] });
          text = r.text;
          keepFirst('hooks', r.emptyInner);
          created.add(`hooks.${event}`);
          added.push(event);
        } else if (!childValues(text, ['hooks', event]).some((c) => isOurs(c.value, [command]))) {
          const r = insertChild(text, ['hooks', event], { value: entry });
          text = r.text;
          keepFirst(`hooks.${event}`, r.emptyInner);
          added.push(event);
        }
      }
    }
  }

  const stale = countStale(text, command);
  const result = { file, scope, command, added, stale, changed: added.length > 0, dryRun };
  if (!result.changed || dryRun) return result;

  result.note = commit(env, file, before, text, scope, beforeWrite);
  const previous = new Set(manifest?.previous_commands ?? []);
  if (manifest?.command && manifest.command !== command) previous.add(manifest.command);
  writeJsonAtomic(manifestFile(env, file), {
    target: file,
    scope,
    command,
    previous_commands: [...previous],
    created_file: createdFile,
    created: [...created],
    empty_inner: emptyInner,
    installed_at: new Date().toISOString(),
  });
  appendEvent(env, makeEvent({ source: 'cli', event: 'hooks.install', data: { scope, events_added: added.length } }));
  return result;
}

function countStale(text, command) {
  let n = 0;
  for (const { value } of childValues(text, ['hooks']) ?? []) {
    for (const entry of value) if (isAnyAsdk(entry) && !isOurs(entry, [command])) n++;
  }
  return n;
}

export function uninstallHooks(env, options = {}) {
  return withCollectorLock(env, 'claude-settings', () => uninstallLocked(env, options));
}

function uninstallLocked(env, { scope = 'user', project, cwd, dryRun = false, all = false, entry = hookEntry({ env }), beforeWrite } = {}) {
  const { file } = settingsTarget(env, { scope, project, cwd });
  const before = readSettings(file);
  const manifest = readManifest(env, file);
  const commands = [entry.hooks[0].command, ...(manifest ? [manifest.command, ...(manifest.previous_commands ?? [])] : [])];
  const matches = all ? isAnyAsdk : (e) => isOurs(e, commands);
  const result = { file, scope, removed: 0, deletedFile: false, changed: false, dryRun, manifest: Boolean(manifest) };
  if (!before) {
    if (manifest && !dryRun) rmSync(manifestFile(env, file), { force: true });
    return result;
  }

  const created = new Set(manifest?.created ?? []);
  const emptyInner = manifest?.empty_inner ?? {};
  let text = before.text;
  for (const { key: event } of childValues(text, ['hooks']) ?? []) {
    const entries = childValues(text, ['hooks', event]);
    for (let i = entries.length - 1; i >= 0; i--) {
      if (!matches(entries[i].value)) continue;
      text = removeChild(text, ['hooks', event], i, { emptyInner: emptyInner[`hooks.${event}`] ?? '' });
      result.removed++;
    }
  }
  // Event members install created, now empty again.
  for (;;) {
    const members = childValues(text, ['hooks']) ?? [];
    const i = members.findIndex((m) => created.has(`hooks.${m.key}`) && m.value.length === 0);
    if (i < 0) break;
    text = removeChild(text, ['hooks'], i, { emptyInner: emptyInner.hooks ?? '' });
  }
  const rootMembers = childValues(text, []);
  const hooksIndex = rootMembers.findLastIndex((m) => m.key === 'hooks');
  if (created.has('hooks') && hooksIndex >= 0 && Object.keys(rootMembers[hooksIndex].value).length === 0) {
    text = removeChild(text, [], hooksIndex, { emptyInner: emptyInner[''] ?? '' });
  }
  let after = text;
  if (manifest?.created_file && childValues(text, []).length === 0) {
    after = null;
    result.deletedFile = true;
  }

  result.changed = after !== before.text;
  if (dryRun) return result;
  if (result.changed) {
    result.note = commit(env, file, before, after, scope, beforeWrite);
    appendEvent(env, makeEvent({ source: 'cli', event: 'hooks.uninstall', data: { scope, entries_removed: result.removed } }));
  }
  if (manifest) rmSync(manifestFile(env, file), { force: true });
  return result;
}

/** What is installed where, for `hooks status` and `health`. Never throws for a bad file; reports it. */
export function inspectHooks(env, { scope = 'user', project, cwd, entry = hookEntry({ env }) } = {}) {
  const { file } = settingsTarget(env, { scope, project, cwd });
  const command = entry.hooks[0].command;
  const report = { file, scope, exists: existsSync(file), command, error: null, installed: [], missing: [], duplicates: 0, stale: 0 };
  let settings;
  try {
    settings = readSettings(file);
  } catch (err) {
    report.error = err.message;
    return report;
  }
  const text = settings?.text ?? '{}';
  for (const event of HOOK_EVENTS) {
    const ours = (childValues(text, ['hooks', event]) ?? []).filter((c) => isOurs(c.value, [command])).length;
    (ours > 0 ? report.installed : report.missing).push(event);
    if (ours > 1) report.duplicates += ours - 1;
  }
  report.stale = countStale(text, command);
  return report;
}
