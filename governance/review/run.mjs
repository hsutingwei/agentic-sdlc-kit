// asdk review run: reviewer agents on the exact commit of a task worktree.
//
// Each reviewer is an independent sterile Claude Code run on its own packet (brief,
// diff, changed files, checks), outside the repository. Its verdict is checked
// against the review-verdict contract and the brief's criteria; "act_on" findings
// are proven by running their reproduction, or by the kit's scope check, which also
// adds a finding of its own for any changed file outside the brief's scope; then the
// review is recorded on the commit with --executor agent: only "accept" passes.
// Notes and packets stay in the data folder (`reviews/`); the event carries numbers only.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ruleError, usageError } from '../../core/errors.mjs';
import { git, headSha, isClean } from '../../core/git.mjs';
import { validateContract } from '../../core/validate.mjs';
import { findClaude, runSterile } from '../../adapters/claude-code/sterile.mjs';
import { dataPath } from '../../collector/lib/paths.mjs';
import { findProject, loadConfig } from '../../collector/lib/registry.mjs';
import { readWorktreeMarker } from '../../collector/lib/state.mjs';
import { recordSnapshot } from '../../collector/lib/quota.mjs';
import { appendEvent, makeEvent } from '../../collector/lib/store.mjs';
import { loadTaskRecords, verifyTask } from '../../collector/lib/tasks.mjs';
import { changedPaths, higherRisk, loadRiskPaths, pathMinimum } from '../gate/risk.mjs';
import { loadProfiles, resolveRole, selectProfile } from '../profiles/profiles.mjs';
import { loadReviewConfig } from './config.mjs';
import { renderNote } from './note.mjs';
import { checksAt, writePacket } from './packet.mjs';
import { proveFindings } from './proof.mjs';

export const PROMPT = 'Read instructions.md in the current folder and follow it. Your final message must be the JSON verdict and nothing else.';
const MAX_REVIEWERS = 9;

/** The JSON object in a reviewer's final message, with or without a code fence. */
export function extractJson(text) {
  const t = String(text ?? '').trim();
  const candidates = [t];
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(t);
  if (fenced) candidates.push(fenced[1]);
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(t.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try the next form
    }
  }
  return undefined;
}

/**
 * Checks a verdict against the contract and the brief.
 * @returns {{ ok: true, verdict: object } | { ok: false, problem: string }}
 */
export function checkVerdict(value, brief) {
  if (value === undefined) return { ok: false, problem: 'the answer held no JSON object' };
  const check = validateContract('review-verdict', value);
  if (!check.valid) return { ok: false, problem: `the verdict does not match the contract: ${check.errors[0].path} ${check.errors[0].message}` };
  const wanted = brief.acceptance_criteria.map((c) => c.id);
  const given = value.criteria.map((c) => c.id);
  const missing = wanted.filter((id) => !given.includes(id));
  if (missing.length) return { ok: false, problem: `the verdict leaves out ${missing.join(', ')}` };
  const unknown = given.filter((id) => !wanted.includes(id));
  if (unknown.length) return { ok: false, problem: `the verdict names criteria the brief does not have: ${unknown.join(', ')}` };
  const ids = value.findings.map((f) => f.id);
  if (new Set(ids).size !== ids.length) return { ok: false, problem: 'two findings share an id' };
  return { ok: true, verdict: value };
}

/** The kit's own finding for a changed file outside the brief's scope. */
const scopeFinding = (o, n) => ({
  id: `S${n}`,
  class: 'act_on',
  title: o.reason === 'forbidden' ? `${o.path} is a path the brief forbids (${o.glob})` : `${o.path} is outside the brief's allowed paths`,
  file: o.path,
  proven: true,
  proven_by: 'scope',
  by: 'kit',
  scope_reason: o.reason,
});

/**
 * What counts after the proofs. An "act_on" finding is proven by a failing test, or
 * by the scope check when it names a changed file outside the brief's scope. When
 * proving is on, an "act_on" finding that was not proven is shown as "consider".
 * Every file outside scope that no "act_on" finding names gets a finding of the kit's
 * own (S1, S2, …), whether proving is on or not. An "accept" with a proven
 * finding becomes "concerns".
 */
export function finalVerdict(verdict, proofs, { proved, scope }) {
  const status = new Map(proofs.map((p) => [p.id, p.status]));
  const outside = new Map((scope?.outside ?? []).map((o) => [o.path, o]));
  const named = new Set();
  const findings = verdict.findings.map((f) => {
    if (f.class === 'act_on' && f.file && outside.has(f.file)) {
      named.add(f.file);
      return { ...f, proven: true, proven_by: 'scope' };
    }
    const byTest = status.get(f.id) === 'proven';
    if (f.class !== 'act_on' || !proved || byTest) return { ...f, proven: byTest, ...(byTest ? { proven_by: 'test' } : {}) };
    return { ...f, class: 'consider', downgraded: true, proven: false };
  });
  let n = 0;
  for (const o of outside.values()) if (!named.has(o.path)) findings.push(scopeFinding(o, ++n));
  const provenActOn = findings.some((f) => f.class === 'act_on' && f.proven);
  const decision = verdict.decision === 'accept' && provenActOn ? 'concerns' : verdict.decision;
  return { decision, findings, ...(scope ? { scope } : {}) };
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function sumUsage(usage) {
  const total = { input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0 };
  for (const u of Object.values(usage ?? {})) for (const k of Object.keys(total)) total[k] += u[k] ?? 0;
  return total;
}

/** The task, its project and worktree, the commit to review and what the reviewers get. */
export function reviewPlan(env, { taskId, count }) {
  const task = loadTaskRecords(env).get(taskId);
  if (!task) throw usageError(`task ${taskId} has not been started`);
  if (task.status === 'ended') throw ruleError(`task ${taskId} has ended`);
  const project = findProject(loadConfig(env), task.project_id);
  if (!project) throw usageError(`project ${task.project_id} is not registered`);
  const integration = project.integration_branch ?? 'dev';
  const marker = readWorktreeMarker(env, project.id, taskId);
  if (!marker) throw ruleError(`task ${taskId} has no worktree; reviewer agents review the task branch before it is merged`);
  const repo = marker.path;
  if (!isClean(repo, env)) throw ruleError(`the worktree has uncommitted changes; commit them first, a review vouches for one commit (${repo})`);
  const sha = headSha(repo, env);
  const base = git(['rev-parse', `refs/heads/${integration}`], { cwd: project.root, env });
  if (Number(git(['rev-list', '--count', `${base}..${sha}`], { cwd: repo, env })) === 0) throw ruleError(`branch ${marker.branch} has no commits to review`);

  // The integration branch's rules, as in wt finish.
  const minimum = pathMinimum(loadRiskPaths(project.root), changedPaths(repo, env, { base, head: sha })).risk;
  const risk = higherRisk(task.risk, minimum);
  const profiles = loadProfiles(project.root);
  const chosen = task.profile ? { name: task.profile, profile: profiles.profiles[task.profile] } : selectProfile(env, profiles);
  if (!chosen.profile) throw usageError(`task ${taskId} names profile "${task.profile}", which does not exist`);
  const role = resolveRole(chosen.profile, 'reviewer', risk);
  const reviewers = count ?? Math.max(1, chosen.profile.verifiers[risk]);
  if (!Number.isInteger(reviewers) || reviewers < 1 || reviewers > MAX_REVIEWERS) throw usageError(`--count must be a whole number from 1 to ${MAX_REVIEWERS}`);
  return { task, project, integration, repo, sha, base, risk, profile: chosen.name, role, reviewers, config: loadReviewConfig(project.root) };
}

/**
 * One reviewer on one commit, recording nothing: packet, sterile run, verdict check,
 * proofs. Shared by `asdk review run` and the skill regression runner.
 * @returns {{ status: 'done' | 'failed' | 'invalid', problem?: string, answer: object, packet: object,
 *             verdict?: object, proofs?: object[], final?: object }}
 */
export function reviewOnce(env, { dir, repo, sha, base, taskId, checks, language, claude, model, effort, prove, proofTimeoutS = 60, timeoutMs }) {
  mkdirSync(dir, { recursive: true });
  const packet = writePacket(env, { dir: path.join(dir, 'packet'), repo, sha, base, taskId, checks, language });
  const answer = runSterile({ claude, cwd: packet.dir, prompt: PROMPT, model, effort, env, timeoutMs });
  writeFileSync(path.join(dir, 'answer.txt'), answer.text ?? '');
  if (!answer.ok) return { status: 'failed', problem: answer.problem, answer, packet };
  const checked = checkVerdict(extractJson(answer.text), packet.brief);
  if (!checked.ok) return { status: 'invalid', problem: checked.problem, answer, packet };
  const proofs = prove ? proveFindings(env, { repo, sha, findings: checked.verdict.findings, timeoutS: proofTimeoutS }) : [];
  const final = finalVerdict(checked.verdict, proofs, { proved: prove, scope: packet.scope });
  return { status: 'done', answer, packet, verdict: checked.verdict, proofs, final };
}

/**
 * Runs the reviewers and records their reviews.
 * @returns {{ sha: string, risk: string, profile: string, model: string, effort: string, runs: object[] }}
 */
export function runReview(env, { taskId, count, claude, prove, now = () => new Date() }) {
  const plan = reviewPlan(env, { taskId, count });
  const { task, project, repo, sha, base, role, config } = plan;
  const proved = prove ?? config.prove;
  const exe = claude ?? findClaude(env);
  const checks = checksAt(env, { task, sha });
  const runs = [];
  for (let i = 1; i <= plan.reviewers; i++) {
    const rel = path.join('reviews', project.id, task.task_id, `${sha.slice(0, 12)}-${stamp(now())}-${i}`);
    const dir = dataPath(env, rel);
    const once = reviewOnce(env, { dir, repo, sha, base, taskId: task.task_id, checks, language: config.language, claude: exe, model: role.model, effort: role.effort, prove: proved, proofTimeoutS: config.proof_timeout_s, timeoutMs: config.reviewer_timeout_minutes * 60000 });
    const { answer } = once;
    if (answer.windows?.length) recordSnapshot(env, { windows: answer.windows, source: 'stream-json', now: now() });
    const meta = { task_id: task.task_id, title: task.title, sha, reviewer: i, model: role.model, effort: role.effort, risk: plan.risk, profile: plan.profile };
    const event = (data) =>
      appendEvent(
        env,
        makeEvent(
          {
            source: 'orchestrator',
            event: 'review.run',
            project_id: project.id,
            task_id: task.task_id,
            data: {
              sha,
              reviewer: i,
              model: role.model,
              effort: role.effort,
              risk: plan.risk,
              dir: rel.split(path.sep).join('/'),
              cost_usd: answer.cost_usd,
              wall_ms: answer.wall_ms,
              turns: answer.num_turns,
              claude_version: answer.loaded?.version,
              tools: answer.loaded ? answer.loaded.tools.join(',') : undefined,
              ...sumUsage(answer.usage),
              ...data,
            },
          },
          now(),
        ),
      );
    if (once.status !== 'done') {
      event({ status: once.status, problem: once.problem.slice(0, 256) });
      runs.push({ reviewer: i, status: once.status, problem: once.problem, dir });
      continue;
    }
    const { verdict, proofs, final } = once;
    writeFileSync(path.join(dir, 'verdict.json'), `${JSON.stringify({ meta, verdict, proofs, final, usage: answer.usage, loaded: answer.loaded }, null, 2)}\n`);
    writeFileSync(path.join(dir, 'note.md'), renderNote({ verdict, final, proofs, meta, language: config.language }));
    const result = final.decision === 'accept' ? 'pass' : 'fail';
    verifyTask(env, { taskId: task.task_id, check: 'review', result, executor: 'agent', sha, source: 'orchestrator', now: now() });
    const howMany = (cls) => final.findings.filter((f) => f.class === cls).length;
    event({
      status: 'done',
      decision: final.decision,
      stated_decision: verdict.decision,
      act_on: howMany('act_on'),
      consider: howMany('consider'),
      noted: howMany('noted'),
      proven: final.findings.filter((f) => f.proven).length,
      unproven: final.findings.filter((f) => f.downgraded).length,
      outside_scope: final.scope?.outside.length ?? 0,
      by_kit: final.findings.filter((f) => f.by === 'kit').length,
    });
    runs.push({ reviewer: i, status: 'done', decision: final.decision, result, dir, note: path.join(dir, 'note.md'), proofs });
  }
  return { sha, risk: plan.risk, profile: plan.profile, model: role.model, effort: role.effort, runs };
}
