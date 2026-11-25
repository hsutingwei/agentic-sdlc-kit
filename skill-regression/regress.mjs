#!/usr/bin/env node
// Skill regression for reviewer agents.
//
//   node skill-regression/regress.mjs prepare <out>
//   node skill-regression/regress.mjs run <out> [--profile max] [--risk medium] [--model m] [--effort e]
//                                             [--claude <path>] [--no-prove] [--only R01,R02]
//   node skill-regression/regress.mjs score <out> [--label <text>] [--write <file.md>]
//   node skill-regression/regress.mjs compare <out> [--baseline <file>] [--write-baseline]
//
// `prepare` builds every case twice (clean and seeded) as repositories outside the kit,
// under neutral names; `run` reviews each with the kit's reviewer exactly as
// `asdk review run` does, sterile, and keeps the answers in <out>; `score` says which
// planted defects were found and what was raised on the clean changes; `compare` lists
// what got worse since the baseline. Only `score` output and the baseline (numbers) are
// meant to be published; the answers stay in <out>.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { tryGit } from '../core/git.mjs';
import { findClaude } from '../adapters/claude-code/sterile.mjs';
import { loadProfiles, resolveRole } from '../governance/profiles/profiles.mjs';
import { INSTRUCTIONS } from '../governance/review/packet.mjs';
import { reviewOnce } from '../governance/review/run.mjs';
import { buildVariant, listCases, loadCase } from './lib/cases.mjs';
import { baselineOf, compareScores, scoreMarkdown, scoreRun } from './lib/score.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = path.join(KIT, 'skill-regression', 'baseline.json');
const USAGE = 'usage: regress.mjs prepare|run|score|compare <out> [options]';
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const writeJson = (f, v) => writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`);

function outsideKit(out) {
  const rel = path.relative(KIT, out);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`${out} is inside the kit; the reviewer must not find the cases next to its packet`);
}

export function prepare(env, out) {
  outsideKit(out);
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} is not empty`);
  mkdirSync(path.join(out, 'repos'), { recursive: true });
  const salt = randomBytes(8).toString('hex');
  const entries = [];
  for (const id of listCases()) {
    const c = loadCase(id);
    for (const variant of ['real', 'seeded']) {
      const name = createHash('sha256').update(`${salt}:${id}:${variant}`).digest('hex').slice(0, 10);
      const built = buildVariant(env, c, variant, path.join(out, 'repos', name));
      entries.push({ name, case: id, variant, task_id: c.brief.task_id, sha: built.sha, base: built.base, defects: built.defects });
    }
  }
  writeJson(path.join(out, 'key.json'), { schema_version: 1, created_at: new Date().toISOString(), entries });
  return entries;
}

function kitCommit() {
  const r = tryGit(['rev-parse', 'HEAD'], { cwd: KIT });
  return r.ok ? r.stdout.trim() : null;
}

export function run(env, out, { profile = 'max', risk = 'medium', model, effort, claude, prove = true, only, language = 'en', timeoutMs = 10 * 60000 } = {}) {
  const key = readJson(path.join(out, 'key.json'));
  const chosen = loadProfiles(null).profiles[profile];
  if (!chosen) throw new Error(`unknown profile ${profile}`);
  const role = resolveRole(chosen, 'reviewer', risk);
  const settings = { model: model ?? role.model, effort: effort ?? role.effort };
  const reviewer = createHash('sha256').update(readFileSync(INSTRUCTIONS)).digest('hex');
  mkdirSync(path.join(out, 'results'), { recursive: true });
  const done = [];
  for (const e of key.entries) {
    if (only && !only.includes(e.case)) continue;
    const file = path.join(out, 'results', `${e.name}.json`);
    if (existsSync(file)) continue; // resumable
    const once = reviewOnce(env, {
      dir: path.join(out, 'runs', e.name),
      repo: path.join(out, 'repos', e.name),
      sha: e.sha,
      base: e.base,
      taskId: e.task_id,
      language,
      claude: claude ?? findClaude(env),
      ...settings,
      prove,
      timeoutMs,
    });
    const a = once.answer;
    const result = {
      name: e.name,
      status: once.status,
      problem: once.problem,
      verdict: once.verdict,
      proofs: once.proofs,
      final: once.final,
      model: settings.model,
      effort: settings.effort,
      reviewer_sha256: reviewer,
      claude_version: a.loaded?.version ?? null,
      cost_usd: a.cost_usd ?? 0,
      wall_ms: a.wall_ms,
      usage: a.usage,
    };
    writeJson(file, result);
    done.push(result);
  }
  return { settings, reviewer, done };
}

function collect(out) {
  const key = readJson(path.join(out, 'key.json'));
  const entries = key.entries.map((e) => {
    const file = path.join(out, 'results', `${e.name}.json`);
    return { ...e, suite: loadCase(e.case).suite, result: existsSync(file) ? readJson(file) : null };
  });
  const results = entries.map((e) => e.result).filter(Boolean);
  const first = results[0] ?? {};
  const meta = {
    reviewer_sha256: first.reviewer_sha256 ?? createHash('sha256').update(readFileSync(INSTRUCTIONS)).digest('hex'),
    model: first.model ?? null,
    effort: first.effort ?? null,
    claude_version: results.find((r) => r.claude_version)?.claude_version ?? null,
    kit_commit: kitCommit(),
    date: new Date().toISOString().slice(0, 10),
  };
  const mixed = new Set(results.map((r) => `${r.reviewer_sha256}|${r.model}|${r.effort}`)).size > 1;
  return { entries, meta, mixed };
}

export function score(out, { label } = {}) {
  const { entries, meta, mixed } = collect(out);
  if (mixed) throw new Error('the results mix reviewer versions or models; score each run in its own folder');
  const s = scoreRun(entries);
  return { score: s, meta: { ...meta, label }, markdown: scoreMarkdown(s, { ...meta, label }) };
}

export async function main(argv, { env = process.env, out: print = console.log } = {}) {
  const [command, dirArg, ...rest] = argv;
  if (!command || !dirArg) throw new Error(USAGE);
  const out = path.resolve(dirArg);
  const { values } = parseArgs({
    args: rest,
    options: {
      profile: { type: 'string' },
      risk: { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      claude: { type: 'string' },
      'no-prove': { type: 'boolean' },
      only: { type: 'string' },
      label: { type: 'string' },
      write: { type: 'string' },
      baseline: { type: 'string' },
      'write-baseline': { type: 'boolean' },
    },
    strict: true,
  });
  if (command === 'prepare') {
    const entries = prepare(env, out);
    print(`prepared ${entries.length} repositories (${entries.length / 2} cases, clean and seeded) in ${out}`);
    return 0;
  }
  if (command === 'run') {
    const r = run(env, out, { profile: values.profile, risk: values.risk, model: values.model, effort: values.effort, claude: values.claude ? findClaude(env, values.claude) : undefined, prove: !values['no-prove'], only: values.only?.split(',') });
    const cost = r.done.reduce((n, x) => n + (x.cost_usd ?? 0), 0);
    print(`${r.done.length} review(s) with ${r.settings.model} at ${r.settings.effort}: ${r.done.filter((x) => x.status === 'done').length} usable, list price USD ${cost.toFixed(2)}`);
    for (const x of r.done.filter((y) => y.status !== 'done')) print(`  ${x.name}: ${x.status}: ${x.problem}`);
    return 0;
  }
  if (command === 'score') {
    const s = score(out, { label: values.label });
    if (values.write) writeFileSync(path.resolve(values.write), s.markdown);
    writeJson(path.join(out, 'score.json'), { meta: s.meta, ...s.score });
    print(s.markdown);
    return 0;
  }
  if (command === 'compare') {
    const s = score(out);
    const file = values.baseline ? path.resolve(values.baseline) : BASELINE;
    if (values['write-baseline']) {
      writeJson(file, baselineOf(s.score, s.meta));
      print(`baseline written: ${file}`);
      return 0;
    }
    if (!existsSync(file)) throw new Error(`no baseline at ${file}; write one with --write-baseline`);
    const regressions = compareScores(readJson(file), s.score);
    print(regressions.length ? `${regressions.length} regression(s):\n  ${regressions.join('\n  ')}` : 'no regressions against the baseline');
    return regressions.length ? 1 : 0;
  }
  throw new Error(USAGE);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`regress: ${err.message}`);
      process.exitCode = 2;
    },
  );
}
