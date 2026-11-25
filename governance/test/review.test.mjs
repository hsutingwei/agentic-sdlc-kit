// Reviewer agents (P8a), with a scripted stand-in for the sterile Claude Code run
// (test/fixtures/fake-reviewer.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox, git, runAsdk } from '../../test/helpers/sandbox.mjs';
import { setupDemo } from '../../tools/lib/demo.mjs';
import { loadConfig, saveConfig } from '../../collector/lib/registry.mjs';
import { readEvents } from '../../collector/lib/store.mjs';
import { loadTasks, startTask, verifyTask } from '../../collector/lib/tasks.mjs';
import { buildReport } from '../../collector/lib/report.mjs';
import { quotaState } from '../../collector/lib/quota.mjs';
import { finishWorktree, newWorktree } from '../../orchestration/lib/worktree.mjs';
import { STERILE_ARGS, sterileEnv } from '../../adapters/claude-code/sterile.mjs';
import { loadReviewConfig } from '../review/config.mjs';
import { failureKind, refuseReproduction } from '../review/proof.mjs';
import { checkVerdict, extractJson, finalVerdict, runReview } from '../review/run.mjs';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures', 'fake-reviewer.mjs');
const claude = { command: process.execPath, args: [FAKE] };

/** A demo with DEMO-001 started at `risk` with the max profile and one committed change in its worktree. */
function setup(t, label, { risk = 'medium', mode = 'accept' } = {}) {
  const sb = createSandbox(t, label);
  const repo = sb.join('專案 demo-api');
  const argsFile = sb.join('reviewer args.jsonl');
  const env = { ...sb.env, FAKE_REVIEW_MODE: mode, FAKE_REVIEW_ARGS_FILE: argsFile, CLAUDE_CODE_EFFORT_LEVEL: 'low' };
  setupDemo(env, { target: repo });
  const config = loadConfig(env);
  config.worktrees = { root: sb.join('工作 樹') };
  saveConfig(env, config);
  startTask(env, { taskId: 'DEMO-001', cwd: repo, type: 'feature', risk, title: 'Add due dates to todo items', estimateHours: 6, profile: 'max' });
  const wt = newWorktree(env, { taskId: 'DEMO-001', slug: 'due dates' }).path;
  writeFileSync(path.join(wt, 'src', 'todos.mjs'), `${readFileSync(path.join(wt, 'src', 'todos.mjs'), 'utf8')}// due dates come next\n`);
  git(sb, wt, 'commit', '-q', '-am', 'feat: DEMO-001 first step');
  const sha = git(sb, wt, 'rev-parse', 'HEAD').trim();
  const calls = () => (existsSync(argsFile) ? readFileSync(argsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { sb, env, repo, wt, sha, calls };
}

const reviews = (env) => loadTasks(env).get('DEMO-001').verifications.filter((v) => v.check === 'review');

test('an accepting reviewer runs sterile with the profile, records a passing agent review on the commit, and wt finish merges', (t) => {
  const { env, sha, calls } = setup(t, 'review-accept');
  const result = runReview(env, { taskId: 'DEMO-001', claude });
  assert.deepEqual([result.sha, result.risk, result.profile, result.model, result.effort, result.runs.length], [sha, 'medium', 'max', 'sonnet', 'high', 1]);
  assert.deepEqual([result.runs[0].status, result.runs[0].decision, result.runs[0].result], ['done', 'accept', 'pass']);

  const [call] = calls();
  for (const flag of [...STERILE_ARGS, '--tools', 'Read', '--output-format', 'stream-json', '--verbose']) assert.ok(call.args.includes(flag), flag);
  assert.deepEqual(call.args.slice(call.args.indexOf('--model'), call.args.indexOf('--model') + 4), ['--model', 'sonnet', '--effort', 'high']);
  assert.deepEqual(call.files, ['brief.json', 'change.diff', 'checks.json', 'files', 'instructions.md'], 'only the packet, nothing of the repository');
  assert.equal(call.env_effort, null, 'the caller\'s CLAUDE_CODE_* settings are not passed on');

  assert.deepEqual(reviews(env).map((v) => `${v.result}:${v.executor}:${v.sha}`), [`pass:agent:${sha}`]);
  const note = readFileSync(result.runs[0].note, 'utf8');
  assert.match(note, /\*\*Accept\.\*\* Every criterion is met\./);
  assert.match(note, /\| AC3 \| ✅ met \|/);

  // The merge policy for medium risk with the max profile asks for one review: this one.
  const finish = finishWorktree(env, { taskId: 'DEMO-001' });
  assert.equal(finish.merged, true, JSON.stringify(finish.reviews ?? finish.reason));

  // The reviewer's tokens count for the task, although no hook fired and no transcript exists.
  const report = buildReport({ events: readEvents(env).events, usageOf: () => null });
  const row = report.rows.find((r) => r.task_id === 'DEMO-001');
  assert.equal(row.output_tokens, 300);
  const run = loadTasks(env).get('DEMO-001').review_runs[0];
  assert.deepEqual([run.status, run.decision, run.cost_usd, run.cache_read_tokens, run.tools, run.claude_version], ['done', 'accept', 0.02, 4000, 'Read', '0.0.0 (fake reviewer)']);
  assert.equal(quotaState(env).windows.seven_day.used_pct, 21, 'the quota windows of the stream are recorded');
  assert.ok(!JSON.stringify(run).includes(env.HOME), 'no absolute path in the event');
});

test('act_on findings are proven by their reproduction; an unproven one is shown as consider; concerns block the merge', (t) => {
  const { env, sha } = setup(t, 'review-prove', { mode: 'prove' });
  const [run] = runReview(env, { taskId: 'DEMO-001', claude }).runs;
  assert.deepEqual([run.decision, run.result], ['concerns', 'fail']);
  assert.deepEqual(run.proofs.map((p) => `${p.id}:${p.status}`), ['F1:proven', 'F2:not_reproduced']);
  const saved = JSON.parse(readFileSync(path.join(run.dir, 'verdict.json'), 'utf8'));
  assert.deepEqual(saved.final.findings.map((f) => `${f.id}:${f.class}:${f.proven}`), ['F1:act_on:true', 'F2:consider:false', 'F3:noted:false']);
  const note = readFileSync(run.note, 'utf8');
  assert.match(note, /\*\*act on\*\* The list is wrong \(`src\/todos\.mjs:20`\)\n {2}proven by a failing test/);
  assert.match(note, /\*\*consider\*\* A suspected problem that is not there\n {2}not reproduced: the test passed\n {2}shown as "consider"/);

  const blocked = finishWorktree(env, { taskId: 'DEMO-001' });
  assert.deepEqual([blocked.merged, blocked.reason, blocked.reviews.blocked], [false, 'reviews', true]);
  // A person who looked at it can still pass it, as for any failing review.
  verifyTask(env, { taskId: 'DEMO-001', check: 'review', result: 'pass', executor: 'human', sha });
  assert.equal(finishWorktree(env, { taskId: 'DEMO-001' }).merged, true);
});

test('a change outside the brief\'s scope gets a proven finding from the kit, even when the reviewer accepts', (t) => {
  const { sb, env, wt } = setup(t, 'review-scope');
  const risk = path.join(wt, '.asdk', 'risk-paths.json');
  writeFileSync(risk, `${readFileSync(risk, 'utf8').trimEnd()}\n`.replace('"medium"', '"low"'));
  writeFileSync(path.join(wt, '說明 筆記.md'), 'notes\n');
  git(sb, wt, 'add', '-A');
  git(sb, wt, 'commit', '-q', '-m', 'feat: DEMO-001 lower a risk rule');
  const [run] = runReview(env, { taskId: 'DEMO-001', claude }).runs;
  assert.deepEqual([run.decision, run.result], ['concerns', 'fail'], 'the fake reviewer accepted');

  const saved = JSON.parse(readFileSync(path.join(run.dir, 'verdict.json'), 'utf8'));
  assert.deepEqual(
    saved.final.findings.map((f) => `${f.id}:${f.class}:${f.proven_by}:${f.by}:${f.file}`),
    ['S1:act_on:scope:kit:.asdk/risk-paths.json', 'S2:act_on:scope:kit:說明 筆記.md'],
  );
  const checks = JSON.parse(readFileSync(path.join(run.dir, 'packet', 'checks.json'), 'utf8'));
  assert.deepEqual(checks.scope.outside.map((o) => o.reason), ['forbidden', 'not_allowed'], 'the reviewer sees the scope check too');
  assert.equal(checks.scope.changed, 3);
  const note = readFileSync(run.note, 'utf8');
  assert.match(note, /## Scope\n\n2 of 3 changed file\(s\) are outside the brief's scope\n- `\.asdk\/risk-paths\.json`: a path the brief forbids \(\.asdk\/\*\*\)/);
  assert.match(note, /\*\*act on\*\* found by the kit: outside the brief's allowed paths \(`說明 筆記\.md`\)\n {2}proven by the kit's scope check/);
  const event = loadTasks(env).get('DEMO-001').review_runs[0];
  assert.deepEqual([event.outside_scope, event.by_kit, event.proven], [2, 2, 2]);
});

test('an accept with a proven finding becomes concerns; a refused reproduction stays unproven', (t) => {
  const a = setup(t, 'review-accept-proven', { mode: 'accept-proven' });
  assert.equal(runReview(a.env, { taskId: 'DEMO-001', claude }).runs[0].decision, 'concerns');
  const b = setup(t, 'review-refused', { mode: 'refused' });
  const [run] = runReview(b.env, { taskId: 'DEMO-001', claude }).runs;
  assert.deepEqual([run.decision, run.proofs[0].status, run.proofs[0].detail], ['concerns', 'refused', 'module "node:fs" is not allowed']);
});

test('a verdict that is missing, off-contract, short of a criterion or an error records no review', (t) => {
  for (const [mode, status, problem] of [
    ['garbage', 'invalid', /no JSON object/],
    ['missing-ac', 'invalid', /leaves out AC3/],
    ['error', 'failed', /ended with an error/],
  ]) {
    const { env } = setup(t, `review-${mode}`, { mode });
    const [run] = runReview(env, { taskId: 'DEMO-001', claude }).runs;
    assert.equal(run.status, status, mode);
    assert.match(run.problem, problem, mode);
    assert.deepEqual(reviews(env), [], mode);
    assert.equal(loadTasks(env).get('DEMO-001').review_runs[0].status, status);
  }
  const loose = setup(t, 'review-not-sterile');
  const [notSterile] = runReview({ ...loose.env, FAKE_REVIEW_TOOLS: 'Read,Bash' }, { taskId: 'DEMO-001', claude }).runs;
  assert.deepEqual([notSterile.status, notSterile.problem], ['failed', 'not sterile: tools Bash were loaded too']);
  assert.deepEqual(reviews(loose.env), []);

  const { env } = setup(t, 'review-fenced', { mode: 'fenced' });
  assert.equal(runReview(env, { taskId: 'DEMO-001', claude }).runs[0].decision, 'accept', 'a fenced answer is read');
});

test('several independent reviewers; without proving, act_on findings stay as they are', (t) => {
  const { env, calls } = setup(t, 'review-count', { mode: 'prove' });
  const result = runReview(env, { taskId: 'DEMO-001', claude, count: 2, prove: false });
  assert.equal(result.runs.length, 2);
  assert.notEqual(result.runs[0].dir, result.runs[1].dir, 'each reviewer gets its own packet');
  assert.equal(calls().length, 2);
  assert.deepEqual(result.runs.map((r) => r.proofs.length), [0, 0]);
  const saved = JSON.parse(readFileSync(path.join(result.runs[0].dir, 'verdict.json'), 'utf8'));
  assert.deepEqual(saved.final.findings.map((f) => f.class), ['act_on', 'act_on', 'noted']);
  assert.equal(reviews(env).length, 2);
  assert.throws(() => runReview(env, { taskId: 'DEMO-001', claude, count: 0 }), /--count must be/);
});

test('high risk asks for the profile\'s verifiers; the language comes from .asdk/review.json on the main checkout', (t) => {
  const { env, repo } = setup(t, 'review-zh', { risk: 'high' });
  writeFileSync(path.join(repo, '.asdk', 'review.json'), `${JSON.stringify({ schema_version: 1, language: 'zh-TW' })}\n`);
  const result = runReview(env, { taskId: 'DEMO-001', claude });
  assert.equal(result.runs.length, 2, 'max has two verifiers for high risk');
  assert.match(readFileSync(path.join(result.runs[0].dir, 'packet', 'instructions.md'), 'utf8'), /in \*\*zh-TW\*\*/);
  assert.match(readFileSync(result.runs[0].note, 'utf8'), /## 對照驗收條件[\s\S]*\| AC1 \| ✅ 符合 \|/);
});

test('a review needs a committed change in a task worktree and the brief in that commit', (t) => {
  const { sb, env, wt } = setup(t, 'review-refuse');
  writeFileSync(path.join(wt, 'scratch.txt'), 'x');
  assert.throws(() => runReview(env, { taskId: 'DEMO-001', claude }), /uncommitted changes/);
  git(sb, wt, 'add', 'scratch.txt');
  git(sb, wt, 'rm', '-q', 'briefs/DEMO-001.json');
  git(sb, wt, 'commit', '-q', '-m', 'chore: drop the brief');
  assert.throws(() => runReview(env, { taskId: 'DEMO-001', claude }), /briefs\/DEMO-001\.json is not in the reviewed commit/);
  assert.throws(() => runReview(env, { taskId: 'DEMO-999', claude }), /has not been started/);
});

test('the command line runs, shows and lists reviews', (t) => {
  const { sb, env, wt } = setup(t, 'review-cli', { mode: 'prove' });
  const ran = runAsdk(sb, ['review', 'run', '--task', 'DEMO-001', '--claude', FAKE], { cwd: wt, env });
  assert.equal(ran.status, 1, ran.stderr);
  assert.match(ran.stdout, /reviewer 1: concerns \(recorded as fail\), 1 of 2 finding\(s\) proven/);
  const shown = runAsdk(sb, ['review', 'show', '--task', 'DEMO-001'], { env });
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /\*\*Concerns\.\*\* One finding is real, one is not\./);
  const listed = runAsdk(sb, ['review', 'list', '--task', 'DEMO-001'], { env });
  assert.match(listed.stdout, /reviewer 1\tsonnet high\tconcerns, 1 proven USD 0\.02/);
  assert.equal(runAsdk(sb, ['review', 'run'], { env }).status, 2);
});

test('verdicts, proofs and settings are checked strictly', (t) => {
  const brief = { acceptance_criteria: [{ id: 'AC1', text: 'x' }] };
  const base = { schema_version: 1, decision: 'accept', summary: 's', criteria: [{ id: 'AC1', result: 'met' }], findings: [] };
  assert.equal(checkVerdict(base, brief).ok, true);
  assert.match(checkVerdict({ ...base, decision: 'maybe' }, brief).problem, /\/decision/);
  assert.match(checkVerdict({ ...base, criteria: [...base.criteria, { id: 'AC2', result: 'met' }] }, brief).problem, /does not have: AC2/);
  assert.match(checkVerdict({ ...base, findings: [{ id: 'F1', class: 'noted', title: 'a' }, { id: 'F1', class: 'noted', title: 'b' }] }, brief).problem, /share an id/);
  assert.match(checkVerdict({ ...base, findings: [{ id: 'F1', class: 'noted', title: 'a', file: '../x' }] }, brief).problem, /\/findings\/0\/file/);
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });

  const verdict = { ...base, findings: [{ id: 'F1', class: 'act_on', title: 'a' }] };
  assert.deepEqual(finalVerdict(verdict, [], { proved: true }).findings.map((f) => f.class), ['consider'], 'no reproduction: not proven');
  assert.deepEqual(finalVerdict(verdict, [], { proved: false }).findings.map((f) => f.class), ['act_on']);
  assert.equal(finalVerdict(verdict, [{ id: 'F1', status: 'proven' }], { proved: true }).decision, 'concerns');
  const scope = { allowed_paths: ['src/**'], forbidden_paths: ['.asdk/**'], changed: 3, outside: [{ path: '.asdk/a.json', reason: 'forbidden', glob: '.asdk/**' }, { path: 'docs/b.md', reason: 'not_allowed' }] };
  const named = { ...verdict, findings: [{ id: 'F1', class: 'act_on', title: 'touches the risk rules', file: '.asdk/a.json' }, { id: 'F2', class: 'consider', title: 'docs changed', file: 'docs/b.md' }] };
  const scoped = finalVerdict(named, [{ id: 'F1', status: 'not_reproduced' }], { proved: true, scope });
  assert.deepEqual(
    scoped.findings.map((f) => `${f.id}:${f.class}:${f.proven}:${f.proven_by ?? '-'}`),
    ['F1:act_on:true:scope', 'F2:consider:false:-', 'S1:act_on:true:scope'],
    'an act_on finding on a file outside scope is proven by the scope; a consider one does not count, so the kit adds its own',
  );
  assert.equal(scoped.decision, 'concerns');
  assert.equal(finalVerdict(named, [], { proved: false, scope }).findings.length, 3, 'the scope check runs without proving too');
  assert.deepEqual(finalVerdict(verdict, [], { proved: true, scope: { ...scope, outside: [] } }).findings.map((f) => f.id), ['F1']);

  assert.equal(failureKind("not ok 1\n  code: 'ERR_ASSERTION'\n"), 'assertion');
  assert.equal(failureKind("  failureType: 'testCodeFailure'\n  stack: |-\n    validateNote (file:///C:/tmp/x/src/todos.mjs:22:49)\n"), 'code', 'the code under test threw');
  assert.equal(failureKind("  failureType: 'testCodeFailure'\n  stack: |-\n    TestContext.<anonymous> (file:///C:/tmp/x/test/proof/F1.test.mjs:3:9)\n"), 'other', 'the test broke on its own');
  assert.equal(failureKind("SyntaxError: Unexpected token\n  code: 'ERR_ASSERTION'"), 'other', 'a test that cannot load proves nothing');
  assert.equal(refuseReproduction("import { test } from 'node:test';\nimport { createServer } from '../../src/server.mjs';"), null);
  assert.match(refuseReproduction("import x from 'fs';"), /module "fs"/);
  assert.match(refuseReproduction('const m = await import("node:fs");'), /dynamic import/);

  const sb = createSandbox(t, 'review-config');
  const top = sb.join('專案');
  assert.deepEqual(loadReviewConfig(top), { language: 'en', prove: true, proof_timeout_s: 60, reviewer_timeout_minutes: 10 });
  const write = (o) => {
    mkdirSync(path.join(top, '.asdk'), { recursive: true });
    writeFileSync(path.join(top, '.asdk', 'review.json'), JSON.stringify(o));
  };
  write({ schema_version: 1, language: 'zh-TW', prove: false });
  assert.deepEqual(loadReviewConfig(top), { language: 'zh-TW', prove: false, proof_timeout_s: 60, reviewer_timeout_minutes: 10 });
  write({ schema_version: 1, colour: 'red' });
  assert.throws(() => loadReviewConfig(top), /unknown setting "colour"/);
  write({ schema_version: 1, language: 'not a tag' });
  assert.throws(() => loadReviewConfig(top), /language must be/);
  assert.equal(sterileEnv({ ANTHROPIC_MODEL: 'x', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_EFFORT_LEVEL: 'low', PATH: '/bin' }).ANTHROPIC_API_KEY, 'k');
  assert.deepEqual(Object.keys(sterileEnv({ ANTHROPIC_MODEL: 'x', CLAUDE_CODE_EFFORT_LEVEL: 'low', AGENTIC_METRICS_HOME: '/m', PATH: '/bin' })), ['PATH']);
});
