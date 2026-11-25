// asdk review run --task <ID> [--count <n>] [--claude <path>] [--no-prove] [--json]
// asdk review show --task <ID> [--sha <commit>]
// asdk review list --task <ID>

import { existsSync, readFileSync } from 'node:fs';
import { parse, requireOption } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { headSha } from '../../core/git.mjs';
import { findClaude } from '../../adapters/claude-code/sterile.mjs';
import { dataPath } from '../../collector/lib/paths.mjs';
import { findProject, loadConfig } from '../../collector/lib/registry.mjs';
import { readWorktreeMarker } from '../../collector/lib/state.mjs';
import { loadTaskRecords } from '../../collector/lib/tasks.mjs';
import { runReview } from './run.mjs';

const RUN = 'asdk review run --task <ID> [--count <n>] [--claude <path>] [--no-prove] [--json]';
const SHOW = 'asdk review show --task <ID> [--sha <commit>]';
const LIST = 'asdk review list --task <ID>';
const USAGE = `${RUN} | ${SHOW} | ${LIST}`;

function taskOf(env, id) {
  const task = loadTaskRecords(env).get(id);
  if (!task) throw usageError(`task ${id} has not been started`);
  return task;
}

/** The commit a person would review now: the worktree's head, else the last one reviewed. */
function currentSha(env, task) {
  const project = findProject(loadConfig(env), task.project_id);
  const marker = project ? readWorktreeMarker(env, project.id, task.task_id) : null;
  if (marker && existsSync(marker.path)) return headSha(marker.path, env);
  return task.review_runs.at(-1)?.sha ?? null;
}

export async function runReviewCommand(argv, { env, out }) {
  const [sub, ...rest] = argv;
  if (sub === 'run') {
    const { values } = parse(rest, { task: { type: 'string' }, count: { type: 'string' }, claude: { type: 'string' }, 'no-prove': { type: 'boolean' }, json: { type: 'boolean' } }, { usage: RUN });
    const taskId = requireOption(values, 'task', RUN);
    const count = values.count === undefined ? undefined : Number(values.count);
    const result = runReview(env, { taskId, count, claude: findClaude(env, values.claude), prove: values['no-prove'] ? false : undefined });
    if (values.json) {
      out(JSON.stringify(result));
    } else {
      out(`review of ${result.sha.slice(0, 12)} (${result.risk} risk, profile ${result.profile}): ${result.runs.length} reviewer(s), ${result.model} effort ${result.effort}`);
      for (const r of result.runs) {
        if (r.status !== 'done') out(`  reviewer ${r.reviewer}: ${r.status}: ${r.problem}`);
        else out(`  reviewer ${r.reviewer}: ${r.decision} (recorded as ${r.result})${r.proofs.length ? `, ${r.proofs.filter((p) => p.status === 'proven').length} of ${r.proofs.length} finding(s) proven` : ''}\n    ${r.note}`);
      }
    }
    return result.runs.every((r) => r.status === 'done' && r.result === 'pass') ? 0 : 1;
  }
  if (sub === 'show') {
    const { values } = parse(rest, { task: { type: 'string' }, sha: { type: 'string' } }, { usage: SHOW });
    const task = taskOf(env, requireOption(values, 'task', SHOW));
    const sha = values.sha ?? currentSha(env, task);
    const runs = task.review_runs.filter((r) => r.sha === sha || (values.sha && r.sha?.startsWith(values.sha)));
    if (runs.length === 0) {
      out(`no reviewer agent has reviewed ${sha ? sha.slice(0, 12) : 'this task'} yet`);
      return 1;
    }
    for (const r of runs) {
      const note = dataPath(env, ...r.dir.split('/'), 'note.md');
      if (r.status === 'done' && existsSync(note)) out(readFileSync(note, 'utf8'));
      else out(`reviewer ${r.reviewer}: ${r.status}${r.problem ? `: ${r.problem}` : ''}\n`);
    }
    return 0;
  }
  if (sub === 'list') {
    const { values } = parse(rest, { task: { type: 'string' } }, { usage: LIST });
    const task = taskOf(env, requireOption(values, 'task', LIST));
    for (const r of task.review_runs) {
      const cost = typeof r.cost_usd === 'number' ? ` USD ${r.cost_usd.toFixed(2)}` : '';
      out(`${r.ts}\t${r.sha?.slice(0, 12)}\treviewer ${r.reviewer}\t${r.model} ${r.effort}\t${r.status === 'done' ? `${r.decision}${r.proven ? `, ${r.proven} proven` : ''}` : r.status}${cost}`);
    }
    return 0;
  }
  throw usageError(`usage: ${USAGE}`);
}
