// Built-in gate steps that check a project's agent configuration.
//
// references  Paths named in agent instructions (AGENTS.md, CLAUDE.md, sub-agent
//             and skill definitions) must exist: an `@import` or a path in
//             backticks that points nowhere sends an agent looking for a file that
//             is gone.
// deny-sync   Every .claude/settings.json below the root must repeat the root's
//             permission deny rules. Claude Code reads the shared settings file from
//             the directory a session starts in, without falling back to the
//             parent, so a subdirectory's file replaces the root rules there.
//
// Both read the committed file list (git ls-files) and return { status, output }.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { matchesGlob } from '../../core/glob.mjs';
import { git } from '../../core/git.mjs';

const AGENT_DOCS = ['AGENTS.md', '**/AGENTS.md', 'CLAUDE.md', '**/CLAUDE.md', '.claude/agents/**/*.md', '.claude/skills/**/SKILL.md'];
// A backticked word is taken as a path when it has a slash or one of these extensions.
const PATH_EXTENSIONS = /\.(md|mjs|cjs|js|ts|tsx|jsx|json|ya?ml|sql|sh|ps1|py|txt|toml|html|css)$/i;
const NOT_A_PATH = /[\s<>{}$*?:|"'()[\]=,;]|^[-@]|^\/|^~|^[A-Za-z]:/;

const trackedFiles = (cwd, env) => git(['ls-files', '-z'], { cwd, env }).split('\0').filter(Boolean);

/** Paths a Markdown text refers to, with line numbers: @imports and backticked paths outside code blocks. */
export function referencedPaths(text) {
  const refs = [];
  let fenced = false;
  text.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const code = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const token of code) {
      if (!NOT_A_PATH.test(token) && (token.includes('/') || PATH_EXTENSIONS.test(token))) refs.push({ line: i + 1, path: token, kind: 'path' });
    }
    // Imports are not expanded inside backticks, so look only at the text outside them.
    const outside = line.replace(/`[^`]*`/g, ' ');
    for (const m of outside.matchAll(/(?:^|\s)@([^\s]+)/g)) {
      const target = m[1].replace(/[.,;:)]+$/, '');
      if (target && !/^~|^\/|^[A-Za-z]:/.test(target) && !target.includes('@')) refs.push({ line: i + 1, path: target, kind: 'import' });
    }
  });
  return refs;
}

export function referencesCheck({ cwd, env }) {
  const files = trackedFiles(cwd, env);
  const docs = files.filter((f) => AGENT_DOCS.some((g) => matchesGlob(f, g)));
  const missing = [];
  let count = 0;
  for (const doc of docs) {
    const text = readFileSync(path.join(cwd, doc), 'utf8');
    for (const ref of referencedPaths(text)) {
      count++;
      const clean = ref.path.replace(/\/+$/, '');
      // Imports resolve from the file that contains them; other paths from the root or that file.
      const candidates = ref.kind === 'import' ? [path.join(cwd, path.dirname(doc), clean)] : [path.join(cwd, clean), path.join(cwd, path.dirname(doc), clean)];
      if (!candidates.some((c) => existsSync(c))) missing.push(`${doc}:${ref.line}  ${ref.kind === 'import' ? '@' : ''}${ref.path} does not exist`);
    }
  }
  if (missing.length) return { status: 1, output: `${missing.length} reference(s) to missing files; fix the path or the instructions:\n${missing.join('\n')}` };
  return { status: 0, output: `${count} references in ${docs.length} file(s) OK` };
}

function denyRules(cwd, file) {
  const value = JSON.parse(readFileSync(path.join(cwd, file), 'utf8').replace(/^﻿/, ''));
  const deny = value?.permissions?.deny ?? [];
  if (!Array.isArray(deny)) throw new Error('"permissions.deny" is not a list');
  return deny;
}

export function denySyncCheck({ cwd, env }) {
  const ROOT = '.claude/settings.json';
  const nested = trackedFiles(cwd, env).filter((f) => f !== ROOT && matchesGlob(f, '**/.claude/settings.json'));
  if (!existsSync(path.join(cwd, ROOT))) return { status: 0, output: `no ${ROOT}; nothing to keep in sync` };
  let root;
  try {
    root = denyRules(cwd, ROOT);
  } catch (err) {
    return { status: 1, output: `${ROOT}: ${err.message}` };
  }
  const problems = [];
  for (const file of nested) {
    let deny;
    try {
      deny = denyRules(cwd, file);
    } catch (err) {
      problems.push(`${file}: ${err.message}`);
      continue;
    }
    const missing = root.filter((rule) => !deny.includes(rule));
    if (missing.length) problems.push(`${file} lacks ${missing.length} root deny rule(s): ${missing.join(', ')}`);
  }
  if (problems.length) return { status: 1, output: `sessions started in these directories would not get the root deny rules:\n${problems.join('\n')}` };
  return { status: 0, output: `${root.length} root deny rule(s); ${nested.length} nested settings file(s) in sync` };
}
