// Skill regression cases: a fictional change to examples/demo-api in two variants.
//
//   cases/<id>/brief.json     the task brief the reviewer gets
//   cases/<id>/real/          whole files the clean change adds (tests)
//   cases/<id>/real.edits     edits the clean change makes to existing files
//   cases/<id>/seeded.edits   edits on top of the clean change: the planted defects
//                             (tagged "defect Dn") and the test changes that let them
//                             through the gate (tagged "hides Dn")
//   cases/<id>/checks/Dn.test.mjs  ground truth: passes on the clean change, fails on the seeded one
//   cases/<id>/suite.json     what each defect is called and which words name it
//   cases/<id>/NOTES.md       case design; never given to a reviewer
//
// An edit block, in plain text so no escaping is needed:
//
//   @@ src/server.mjs defect D1
//   <<<
//   the exact lines to find (once)
//   ===
//   the lines to put there
//   >>>

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../../core/git.mjs';
import { validateContract } from '../../core/validate.mjs';
import { copyDir } from '../../core/fs.mjs';

export const CASES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cases');
export const DEMO_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'examples', 'demo-api');
export const CHECKS_AT = 'test/regression';
const IDENTITY = ['-c', 'user.name=Demo Dev', '-c', 'user.email=dev@example.invalid'];
const lf = (s) => s.replace(/\r\n/g, '\n');

export const listCases = () =>
  readdirSync(CASES_DIR)
    .filter((d) => /^R[0-9]{2}$/.test(d))
    .sort();

/** Parses an .edits file into [{ file, tag: { kind, defect } | null, find, replace }]. */
export function parseEdits(text, label = 'edits') {
  const lines = lf(text).split('\n');
  const edits = [];
  let i = 0;
  const fail = (msg) => {
    throw new Error(`${label}:${i + 1}: ${msg}`);
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.startsWith('#')) {
      i++;
      continue;
    }
    const head = /^@@ (\S+)(?: (defect|hides) (D[0-9]+))?$/.exec(line);
    if (!head) fail(`expected "@@ <file> [defect|hides Dn]", got "${line}"`);
    if (lines[i + 1] !== '<<<') fail('expected <<<');
    i += 2;
    const find = [];
    while (i < lines.length && lines[i] !== '===') find.push(lines[i++]);
    if (lines[i] !== '===') fail('expected ===');
    i++;
    const replace = [];
    while (i < lines.length && lines[i] !== '>>>') replace.push(lines[i++]);
    if (lines[i] !== '>>>') fail('expected >>>');
    i++;
    if (find.length === 0) fail('nothing to find');
    edits.push({ file: head[1], tag: head[2] ? { kind: head[2], defect: head[3] } : null, find: find.join('\n'), replace: replace.join('\n') });
  }
  return edits;
}

/**
 * Applies edits in `dir`; each `find` must occur exactly once. Files are written with LF.
 * @returns {Record<string, { file: string, line: number }>} where each defect's edit starts
 */
export function applyEdits(dir, edits) {
  const where = {};
  for (const e of edits) {
    const file = path.join(dir, ...e.file.split('/'));
    if (!existsSync(file)) throw new Error(`${e.file} does not exist`);
    const text = lf(readFileSync(file, 'utf8'));
    const at = text.indexOf(e.find);
    if (at < 0) throw new Error(`${e.file}: the text to find is not there:\n${e.find}`);
    if (text.indexOf(e.find, at + 1) >= 0) throw new Error(`${e.file}: the text to find occurs more than once:\n${e.find}`);
    writeFileSync(file, text.slice(0, at) + e.replace + text.slice(at + e.find.length));
    if (e.tag?.kind === 'defect') where[e.tag.defect] = { file: e.file, line: text.slice(0, at).split('\n').length, replace: e.replace };
  }
  // Later edits can move earlier ones: find each defect again in the finished file.
  for (const d of Object.values(where)) {
    const final = lf(readFileSync(path.join(dir, ...d.file.split('/')), 'utf8'));
    const at = d.replace.trim() ? final.indexOf(d.replace) : -1;
    if (at >= 0) d.line = final.slice(0, at).split('\n').length;
    delete d.replace;
  }
  return where;
}

function filesUnder(dir, rel = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...filesUnder(abs, r));
    else out.push({ rel: r, abs });
  }
  return out;
}

export function loadCase(id) {
  const dir = path.join(CASES_DIR, id);
  const read = (name) => readFileSync(path.join(dir, name), 'utf8');
  const brief = JSON.parse(read('brief.json'));
  const suite = JSON.parse(read('suite.json'));
  const realEdits = existsSync(path.join(dir, 'real.edits')) ? parseEdits(read('real.edits'), `${id}/real.edits`) : [];
  const seededEdits = parseEdits(read('seeded.edits'), `${id}/seeded.edits`);
  const checks = filesUnder(path.join(dir, 'checks'));
  return { id, dir, brief, suite, realFiles: filesUnder(path.join(dir, 'real')), realEdits, seededEdits, checks };
}

/** Problems with a case definition itself (not with how it behaves). */
export function caseProblems(c) {
  const problems = [];
  const check = validateContract('task-brief', c.brief);
  if (!check.valid) problems.push(`brief.json: ${check.errors[0].path} ${check.errors[0].message}`);
  if (c.suite.schema_version !== 1 || !Array.isArray(c.suite.defects) || c.suite.defects.length === 0) problems.push('suite.json needs schema_version 1 and at least one defect');
  const ids = (c.suite.defects ?? []).map((d) => d.id);
  for (const d of c.suite.defects ?? []) {
    if (!d.title || !d.file || !Array.isArray(d.keywords) || d.keywords.length === 0) problems.push(`suite.json ${d.id}: needs title, file and keywords`);
    const planted = c.seededEdits.filter((e) => e.tag?.kind === 'defect' && e.tag.defect === d.id);
    if (planted.length !== 1) problems.push(`${d.id}: needs exactly one "defect ${d.id}" edit, found ${planted.length}`);
    else if (planted[0].file !== d.file) problems.push(`${d.id}: suite says ${d.file}, the edit changes ${planted[0].file}`);
    if (!c.checks.some((f) => f.rel === `${d.id}.test.mjs`)) problems.push(`${d.id}: checks/${d.id}.test.mjs is missing`);
  }
  for (const e of c.seededEdits) if (e.tag && !ids.includes(e.tag.defect)) problems.push(`seeded.edits names ${e.tag.defect}, which suite.json does not list`);
  return problems;
}

const g = (cwd, env, ...args) => git(args, { cwd, env });

/**
 * A repository with the demo on `dev` and the change as one commit on `task`.
 * @returns {{ repo: string, base: string, sha: string, defects: Record<string, { file: string, line: number }> }}
 */
export function buildVariant(env, c, variant, repo) {
  if (!['real', 'seeded'].includes(variant)) throw new Error(`unknown variant ${variant}`);
  copyDir(DEMO_TEMPLATE, repo);
  // The planner writes the brief before the work starts, so it is part of the base.
  writeFileSync(path.join(repo, 'briefs', `${c.brief.task_id}.json`), `${JSON.stringify(c.brief, null, 2)}\n`);
  g(repo, env, 'init', '-q', '-b', 'dev');
  g(repo, env, 'add', '.');
  g(repo, env, ...IDENTITY, 'commit', '-q', '-m', 'chore: demo-api');
  g(repo, env, 'switch', '-q', '-c', 'task');
  for (const f of c.realFiles) {
    const to = path.join(repo, ...f.rel.split('/'));
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(f.abs, to);
  }
  applyEdits(repo, c.realEdits);
  const defects = variant === 'seeded' ? applyEdits(repo, c.seededEdits) : {};
  g(repo, env, 'add', '-A');
  g(repo, env, ...IDENTITY, 'commit', '-q', '-m', `feat: ${c.brief.task_id} ${c.brief.title}`);
  return { repo, base: 'dev', sha: g(repo, env, 'rev-parse', 'HEAD'), defects };
}

/** Copies the case's checks into `repo` (working tree only) and returns their paths. */
export function placeChecks(c, repo) {
  return c.checks.map((f) => {
    const rel = `${CHECKS_AT}/${f.rel}`;
    const to = path.join(repo, ...rel.split('/'));
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(f.abs, to);
    return { id: f.rel.replace(/\.test\.mjs$/, ''), rel };
  });
}
