// Private keyword check for commits.
//
// The rule list lives outside the repository and is maintained by each user
// (company names, internal host names, real project ids...). Hits are reported
// by file, line and the rule's line number in the list only: the matched text is
// never printed, so the output can be shared without leaking the keyword.
//
// List format, one rule per line:
//   keyword          block when the text contains the keyword (case-insensitive)
//   re:<regex>       block when a JavaScript regular expression matches (flags i and u)
//   warn:keyword     print a warning but allow the commit
//   warn:re:<regex>  same, with a regular expression
//   # comment        blank lines and lines starting with # are ignored
//
// Matching is done here, in JavaScript, so rules behave the same on every
// platform regardless of the regex flavour git was built with.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export const DENYLIST_ENV = 'AGENTIC_SDLC_DENYLIST';

export const EXIT = Object.freeze({ PASS: 0, HITS: 1, CONFIG: 2 });

// Like git: a NUL byte in the first 8000 bytes marks a file as binary.
const BINARY_PROBE = 8000;

export class DenylistError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DenylistError';
  }
}

export function defaultDenylistPath(home = os.homedir()) {
  return path.join(home, '.config', 'agentic-sdlc-kit', 'denylist.txt');
}

/**
 * Parses the list. Throws DenylistError for an invalid regular expression,
 * naming the line number but not the rule text.
 * @returns {Array<{ line: number, level: 'block' | 'warn', kind: 'text' | 'regex', test: (s: string) => boolean }>}
 */
export function parseDenylist(text) {
  const rules = [];
  const seen = new Set();
  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      let body = raw.trim();
      if (body === '' || body.startsWith('#')) return;
      const line = index + 1;
      let level = 'block';
      if (body.toLowerCase().startsWith('warn:')) {
        level = 'warn';
        body = body.slice(5).trim();
      }
      let kind = 'text';
      if (body.toLowerCase().startsWith('re:')) {
        kind = 'regex';
        body = body.slice(3);
      }
      if (body === '') throw new DenylistError(`line ${line}: empty rule`);
      const key = `${level}\0${kind}\0${kind === 'text' ? body.toLowerCase() : body}`;
      if (seen.has(key)) return;
      seen.add(key);

      let test;
      if (kind === 'regex') {
        let re;
        try {
          re = new RegExp(body, 'iu');
        } catch {
          throw new DenylistError(`line ${line}: invalid regular expression`);
        }
        if (re.test('')) throw new DenylistError(`line ${line}: regular expression matches empty text`);
        test = (s) => re.test(s);
      } else {
        const needle = body.toLowerCase();
        test = (s) => s.toLowerCase().includes(needle);
      }
      rules.push({ line, level, kind, test });
    });
  return rules;
}

/** True when `child` is `parent` or inside it. Case-insensitive on Windows. */
export function isInside(child, parent, platform = process.platform) {
  const lib = platform === 'win32' ? path.win32 : path.posix;
  let c = lib.resolve(child);
  let p = lib.resolve(parent);
  if (platform === 'win32') {
    c = c.toLowerCase();
    p = p.toLowerCase();
  }
  const rel = lib.relative(p, c);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${lib.sep}`) && !lib.isAbsolute(rel));
}

/** First matching block rule, else first matching warn rule, else null. */
export function matchRule(text, rules) {
  let warn = null;
  for (const rule of rules) {
    if (!rule.test(text)) continue;
    if (rule.level === 'block') return rule;
    warn ??= rule;
  }
  return warn;
}

function realpathIfExists(p) {
  try {
    return realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

function git(args, { cwd, env, input, encoding = 'utf8' }) {
  const result = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    env,
    input,
    encoding: encoding === 'buffer' ? undefined : encoding,
    maxBuffer: 1024 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new DenylistError(`could not run git: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : result.stderr;
    throw new DenylistError(`git ${args[0]} failed: ${stderr.trim()}`);
  }
  return result.stdout;
}

/** Reads the blobs of the index entries with one `git cat-file --batch` call. */
function readIndexBlobs(top, env) {
  const entries = [];
  for (const record of git(['ls-files', '-s', '-z'], { cwd: top, env }).split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    const [mode, sha, stage] = record.slice(0, tab).split(' ');
    // Only regular files; skip symlinks, submodules and conflicted higher stages.
    if ((mode === '100644' || mode === '100755') && stage === '0') entries.push({ file: record.slice(tab + 1), sha });
  }
  if (entries.length === 0) return [];

  const out = git(['cat-file', '--batch'], { cwd: top, env, input: entries.map((e) => e.sha).join('\n') + '\n', encoding: 'buffer' });
  const files = [];
  let pos = 0;
  for (const entry of entries) {
    const headerEnd = out.indexOf(0x0a, pos);
    const header = out.toString('utf8', pos, headerEnd).split(' ');
    const size = Number(header[2]);
    const start = headerEnd + 1;
    files.push({ file: entry.file, content: out.subarray(start, start + size) });
    pos = start + size + 1;
  }
  return files;
}

function readTrackedFiles(top, env) {
  const files = [];
  for (const file of git(['ls-files', '-z'], { cwd: top, env }).split('\0')) {
    if (file === '') continue;
    try {
      files.push({ file, content: readFileSync(path.join(top, file)) });
    } catch {
      // Deleted in the working tree or not a regular file: nothing to scan.
    }
  }
  return files;
}

/**
 * Scans the index (mode "staged") or tracked working-tree files (mode "tracked").
 * @returns {Array<{ file: string, line?: number, rule: object }>}
 */
export function scan({ top, env, rules, mode }) {
  const files = mode === 'staged' ? readIndexBlobs(top, env) : readTrackedFiles(top, env);
  const decoder = new TextDecoder('utf-8');
  const hits = [];
  for (const { file, content } of files) {
    const nameRule = matchRule(file, rules);
    if (nameRule) hits.push({ file, rule: nameRule, inName: true });

    if (content.subarray(0, BINARY_PROBE).includes(0)) continue;
    decoder
      .decode(content)
      .split(/\r?\n/)
      .forEach((text, i) => {
        const rule = matchRule(text, rules);
        if (rule) hits.push({ file, line: i + 1, rule });
      });
  }
  return hits;
}

/**
 * Checks the identities the next commit will carry. Commit metadata is published
 * with the repository just like file contents, so a company account name in
 * user.name or user.email leaks as surely as one in a file.
 * Identities git cannot resolve are skipped: git itself refuses that commit.
 */
export function scanIdentities({ top, env, rules }) {
  const hits = [];
  for (const [variable, label] of [
    ['GIT_AUTHOR_IDENT', 'commit author'],
    ['GIT_COMMITTER_IDENT', 'commit committer'],
  ]) {
    let ident;
    try {
      ident = git(['var', variable], { cwd: top, env }).trim();
    } catch {
      continue;
    }
    // "Name <email> 1700000000 +0800": drop the timestamp.
    const rule = matchRule(ident.replace(/\s+\d+\s+[+-]\d{4}$/, ''), rules);
    if (rule) hits.push({ identity: label, rule });
  }
  return hits;
}

/** Reads the list location from the environment. */
export function resolveDenylist(env, home) {
  const configured = env[DENYLIST_ENV];
  if (configured !== undefined && configured.trim().toLowerCase() === 'none') return { skip: true };
  if (configured !== undefined && configured.trim() !== '') return { file: path.resolve(configured.trim()) };
  return { file: defaultDenylistPath(home) };
}

const describe = (hit) => {
  const rule = `${hit.rule.level === 'warn' ? 'warn ' : ''}rule at line ${hit.rule.line}`;
  if (hit.identity) return `  ${hit.identity} name or email  (${rule})`;
  return hit.inName ? `  ${hit.file}  (file name, ${rule})` : `  ${hit.file}:${hit.line}  (${rule})`;
};

/**
 * Full check as run by the pre-commit hook. Writes messages to `log` and returns an exit code.
 */
export function runCheck({ cwd, env = process.env, home = os.homedir(), mode = 'staged', log = console.error }) {
  const where = resolveDenylist(env, home);
  if (where.skip) {
    log(`check-denylist: skipped (${DENYLIST_ENV}=none)`);
    return EXIT.PASS;
  }

  try {
    const top = realpathIfExists(git(['rev-parse', '--show-toplevel'], { cwd, env }).trim());

    if (!existsSync(where.file)) {
      log(
        [
          `check-denylist: no denylist found at ${where.file}`,
          'Create it outside this repository (one rule per line, # starts a comment),',
          `point ${DENYLIST_ENV} at another file, or set ${DENYLIST_ENV}=none to skip the check on purpose.`,
        ].join('\n'),
      );
      return EXIT.CONFIG;
    }
    if (isInside(realpathIfExists(where.file), top)) {
      log(`check-denylist: the denylist must live outside the repository: ${where.file}`);
      return EXIT.CONFIG;
    }

    const rules = parseDenylist(readFileSync(where.file, 'utf8'));
    if (!rules.some((r) => r.level === 'block')) {
      log(
        `check-denylist: the denylist at ${where.file} has no blocking rules. ` +
          `Add rules, or set ${DENYLIST_ENV}=none to skip the check on purpose.`,
      );
      return EXIT.CONFIG;
    }

    const hits = scan({ top, env, rules, mode });
    if (mode === 'staged') hits.push(...scanIdentities({ top, env, rules }));
    const blocks = hits.filter((h) => h.rule.level === 'block');
    const warns = hits.filter((h) => h.rule.level === 'warn');
    const what = mode === 'staged' ? 'the commit (files or identity)' : 'tracked files';

    if (warns.length > 0) {
      log([`check-denylist: warning - ${what} match warn rules; check that they are fine to publish:`, ...warns.map(describe)].join('\n'));
    }
    if (blocks.length === 0) return EXIT.PASS;
    log(
      [
        `check-denylist: blocked - ${what} match the private denylist:`,
        ...blocks.map(describe),
        'Matched text is not printed. Fix or unstage those files, then commit again.',
      ].join('\n'),
    );
    return EXIT.HITS;
  } catch (err) {
    if (err instanceof DenylistError) {
      log(`check-denylist: ${err.message}`);
      return EXIT.CONFIG;
    }
    throw err;
  }
}
