// Rules from mistakes (.asdk/rules.json): a mistake that happened more than once
// becomes a line pattern with a message that says how to do it right.
//
//   { "schema_version": 1,
//     "rules": [ {
//       "id": "utc-dates",
//       "files": ["src/**/*.mjs"],
//       "pattern": "\\.getDate\\(",
//       "message": "Compare dates in UTC: ...",
//       "origin": "where the mistake was made",
//       "examples": { "bad": ["d.getDate()"], "good": ["d.getUTCDate()"] } } ] }
//
// Every rule carries the mistake it was made for (`bad`) and code it must leave
// alone (`good`); `asdk rules test` proves both before the rule is trusted. A line
// that must break a rule says so with `asdk-allow: <id>`, which keeps the exception
// visible in review.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { usageError } from '../../core/errors.mjs';
import { matchesGlob } from '../../core/glob.mjs';
import { git } from '../../core/git.mjs';

export const RULES_FILE = path.join('.asdk', 'rules.json');
const ID = /^[a-z][a-z0-9-]*$/;
const FLAGS = /^[iu]*$/;
const MAX_FINDINGS = 50;

const asList = (v) => (typeof v === 'string' ? [v] : v);

/** The project's rules, each with its compiled `re`; empty when there is no rules file. */
export function loadRules(top) {
  const file = path.join(top, RULES_FILE);
  if (!existsSync(file)) return [];
  const fail = (msg) => {
    throw usageError(`${RULES_FILE}: ${msg}`);
  };
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    fail(`not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(config?.rules)) fail('"rules" must be an array');
  const seen = new Set();
  return config.rules.map((r, i) => {
    const at = `rule ${r?.id ?? i + 1}`;
    if (!ID.test(r?.id ?? '')) fail(`rule ${i + 1}: "id" must be lowercase letters, digits and -`);
    if (seen.has(r.id)) fail(`${at}: duplicate id`);
    seen.add(r.id);
    if (!Array.isArray(r.files) || r.files.length === 0 || !r.files.every((g) => typeof g === 'string' && g !== '')) fail(`${at}: "files" must be a non-empty list of globs`);
    if (typeof r.pattern !== 'string' || r.pattern === '') fail(`${at}: "pattern" must be a regular expression`);
    if (r.flags !== undefined && (typeof r.flags !== 'string' || !FLAGS.test(r.flags))) fail(`${at}: "flags" may only contain i and u`);
    let re;
    try {
      re = new RegExp(r.pattern, r.flags ?? '');
    } catch (err) {
      fail(`${at}: "pattern" is not a valid regular expression: ${err.message}`);
    }
    if (typeof r.message !== 'string' || r.message.length < 10) fail(`${at}: "message" must say how to fix it`);
    if (typeof r.origin !== 'string' || r.origin === '') fail(`${at}: "origin" must say where the mistake was made`);
    const bad = asList(r.examples?.bad);
    const good = asList(r.examples?.good);
    if (!Array.isArray(bad) || bad.length === 0 || !bad.every((x) => typeof x === 'string')) fail(`${at}: "examples.bad" must show the mistake`);
    if (!Array.isArray(good) || good.length === 0 || !good.every((x) => typeof x === 'string')) fail(`${at}: "examples.good" must show code the rule leaves alone`);
    return { ...r, re, examples: { bad, good } };
  });
}

const allowed = (line, id) => line.includes(`asdk-allow: ${id}`);
const hits = (rule, text) => text.split(/\r?\n/).some((line) => rule.re.test(line) && !allowed(line, rule.id));

/** Whether each rule catches its own mistake and leaves its good examples alone. */
export function testRules(rules) {
  return rules.map((rule) => {
    const problems = [];
    rule.examples.bad.forEach((x, i) => {
      if (!hits(rule, x)) problems.push(`does not catch bad example ${i + 1}: ${x}`);
    });
    rule.examples.good.forEach((x, i) => {
      if (hits(rule, x)) problems.push(`flags good example ${i + 1}: ${x}`);
    });
    return { id: rule.id, ok: problems.length === 0, problems };
  });
}

/** Lines in the committed files that break a rule: { file, line, id, message, text }. */
export function checkRules(rules, { cwd, env }) {
  if (rules.length === 0) return [];
  const files = git(['ls-files', '-z'], { cwd, env }).split('\0').filter(Boolean);
  const findings = [];
  for (const file of files) {
    const applicable = rules.filter((r) => r.files.some((g) => matchesGlob(file, g)));
    if (applicable.length === 0) continue;
    const full = path.join(cwd, file);
    if (!existsSync(full)) continue; // deleted in the working tree
    readFileSync(full, 'utf8')
      .split(/\r?\n/)
      .forEach((text, i) => {
        for (const r of applicable) {
          if (r.re.test(text) && !allowed(text, r.id)) findings.push({ file, line: i + 1, id: r.id, message: r.message, text: text.trim().slice(0, 160) });
        }
      });
  }
  return findings;
}

/** Gate step: the rules must prove themselves, then the files must keep them. */
export function rulesStep({ cwd, env }) {
  const rules = loadRules(cwd);
  if (rules.length === 0) return { status: 0, output: `no ${RULES_FILE}; nothing to check` };
  const broken = testRules(rules).filter((r) => !r.ok);
  if (broken.length) return { status: 1, output: `rules that do not prove themselves (asdk rules test):\n${broken.map((r) => `${r.id}: ${r.problems.join('; ')}`).join('\n')}` };
  const findings = checkRules(rules, { cwd, env });
  if (findings.length === 0) return { status: 0, output: `${rules.length} rule(s), no findings` };
  const lines = findings.slice(0, MAX_FINDINGS).map((f) => `${f.file}:${f.line}  [${f.id}] ${f.message}\n    ${f.text}`);
  const more = findings.length > MAX_FINDINGS ? `\n... and ${findings.length - MAX_FINDINGS} more` : '';
  return { status: 1, output: `${findings.length} finding(s):\n${lines.join('\n')}${more}` };
}
