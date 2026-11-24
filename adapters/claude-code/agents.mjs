// Writes a profile's model and reasoning effort into Claude Code sub-agent
// definitions (.claude/agents/*.md). An agent whose `name` is a role of the
// profile gets that role's `model` and `effort` frontmatter lines; every other
// byte of the file stays as it was, including line endings.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const AGENTS_DIR = path.join('.claude', 'agents');

/** The frontmatter block of a Markdown file: { start, end, text, eol } or null. */
export function frontmatter(text) {
  const m = /^(﻿?)---(\r?\n)([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!m) return null;
  const start = m[1].length + 3 + m[2].length;
  return { start, end: start + m[3].length, text: m[3], eol: m[2] };
}

// The value stops before a CR, so CRLF files keep their line endings.
const FIELD = (key) => new RegExp(`^${key}:[ \\t]*([^\\r\\n]*?)[ \\t]*(?=\\r?$)`, 'm');

export function readField(front, key) {
  return FIELD(key).exec(front)?.[1].replace(/^(['"])(.*)\1$/, '$2') ?? null;
}

/** Sets `key: value` in the frontmatter text, adding the line at the end when missing. */
export function setField(front, key, value, eol) {
  const re = FIELD(key);
  if (re.test(front)) return front.replace(re, `${key}: ${value}`);
  return `${front}${eol}${key}: ${value}`;
}

/**
 * Applies `settings(role)` -> { model, effort } | null to every agent file under `top`.
 * @returns {Array<{ file: string, role: string | null, changed: boolean, from?: object, to?: object }>}
 */
export function applyToAgents(top, settings, { dryRun = false } = {}) {
  const dir = path.join(top, AGENTS_DIR);
  if (!existsSync(dir)) return [];
  const results = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const file = path.join(dir, name);
    const rel = path.join(AGENTS_DIR, name).split(path.sep).join('/');
    const text = readFileSync(file, 'utf8');
    const front = frontmatter(text);
    const role = front ? readField(front.text, 'name') : null;
    const want = role ? settings(role) : null;
    if (!front || !want) {
      results.push({ file: rel, role, changed: false });
      continue;
    }
    const from = { model: readField(front.text, 'model'), effort: readField(front.text, 'effort') };
    let next = setField(front.text, 'model', want.model, front.eol);
    next = setField(next, 'effort', want.effort, front.eol);
    const changed = next !== front.text;
    if (changed && !dryRun) writeFileSync(file, text.slice(0, front.start) + next + text.slice(front.end));
    results.push({ file: rel, role, changed, from, to: { model: want.model, effort: want.effort } });
  }
  return results;
}
