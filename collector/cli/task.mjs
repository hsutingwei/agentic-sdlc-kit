// asdk task start|verify|update|escalate|end|list

import { parse, requireOption } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { repoInfo } from '../../core/git.mjs';
import { loadProfiles, selectProfile } from '../../governance/profiles/profiles.mjs';
import { humanStatus } from '../lib/human.mjs';
import { findProject, loadConfig } from '../lib/registry.mjs';
import { readEvents } from '../lib/store.mjs';
import { endTask, escalateTask, loadTasks, startTask, toContract, updateTask, verifyTask } from '../lib/tasks.mjs';

const USAGE = {
  start:
    'asdk task start <ID> --type <bugfix|feature|refactor|test|docs|config|investigation> --risk <low|medium|high|critical> ' +
    '[--estimate <hours without AI>] [--title <text>] [--fixes <ID,...>] [--project <id>] [--profile <name>]',
  verify: 'asdk task verify <ID> --check <build|unit|integration|ui|review|acceptance> --result <pass|fail|error> --executor <script|agent|human> [--sha <commit>]',
  update: 'asdk task update <ID> --state <blocked|resumed> --reason <text> [--waiting-on <human|ai|external|quota|other>]',
  escalate: 'asdk task escalate <ID> --kind <takeover|repeated_failure|risk_decision> --reason <text>',
  end: 'asdk task end <ID> --outcome <accepted|rejected|abandoned|deferred> [--completed-by <ai|ai_with_human_fixes|human>]',
  list: 'asdk task list [--json]   (text: id, project, status, outcome, human minutes, escalations)',
};

/**
 * Collects the token usage of the task's sessions once it has ended. Never fails the
 * command: the task is already ended, and `asdk harvest --task` can be run again later.
 */
async function harvestAfterEnd(env, id, { out, err }) {
  try {
    // The usage format of each tool lives in its adapter; Claude Code is the only one so far.
    const { harvestSessions, sessionsOfTask } = await import('../../adapters/claude-code/harvest-cli.mjs');
    const results = harvestSessions(env, sessionsOfTask(readEvents(env).events, id));
    if (results.length === 0) return;
    const by = (status) => results.filter((r) => r.status === status).length;
    out(`usage: ${by('harvested') + by('unchanged')} of ${results.length} session(s) harvested`);
    for (const r of results.filter((x) => x.status === 'failed')) err(`warning: could not harvest ${r.session_id}: ${r.error}`);
    if (by('missing')) err(`warning: no transcript found for ${by('missing')} session(s); usage for them stays empty`);
  } catch (e) {
    err(`warning: usage was not harvested (${e.message}); run asdk harvest --task ${id}`);
  }
}

function taskId(positionals, usage) {
  if (positionals.length !== 1) throw usageError(`usage: ${usage}`);
  return positionals[0];
}

/**
 * The plan profile a new task runs with: --profile, else the one for the current plan, else none.
 * Profiles are read from the task's project, so its own .asdk/profiles.json applies.
 */
function startProfile(env, cwd, values) {
  const top = values.project ? findProject(loadConfig(env), values.project)?.root : repoInfo(cwd, env)?.toplevel;
  const profiles = loadProfiles(top);
  if (values.profile !== undefined) return { ...selectProfile(env, profiles, { profile: values.profile }), source: 'manual' };
  try {
    return { ...selectProfile(env, profiles), source: 'auto' };
  } catch {
    return null; // no plan recorded, or a plan without a profile
  }
}

export async function runTask(argv, { env, cwd, out, err }) {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'start': {
      const u = USAGE.start;
      const { values, positionals } = parse(
        rest,
        { type: { type: 'string' }, risk: { type: 'string' }, estimate: { type: 'string' }, title: { type: 'string' }, fixes: { type: 'string' }, project: { type: 'string' }, profile: { type: 'string' } },
        { positionals: 1, usage: u },
      );
      let estimateHours;
      if (values.estimate !== undefined) {
        estimateHours = Number(values.estimate);
        if (!Number.isFinite(estimateHours) || estimateHours <= 0) throw usageError('--estimate must be a positive number of hours');
      }
      const profile = startProfile(env, cwd, values);
      const e = startTask(env, {
        taskId: taskId(positionals, u),
        cwd,
        projectId: values.project,
        type: requireOption(values, 'type', u),
        risk: requireOption(values, 'risk', u),
        title: values.title,
        estimateHours,
        fixes: values.fixes ? values.fixes.split(',').map((s) => s.trim()).filter(Boolean) : [],
        profile: profile?.name,
        profileSource: profile?.source,
      });
      const how = profile ? `, profile ${profile.name} (${profile.source === 'manual' ? 'chosen' : `from plan ${profile.plan}`})` : ', no profile (no plan known)';
      out(`started ${e.task_id} (${e.project_id})${how}`);
      return 0;
    }
    case 'verify': {
      const u = USAGE.verify;
      const { values, positionals } = parse(
        rest,
        { check: { type: 'string' }, result: { type: 'string' }, executor: { type: 'string' }, sha: { type: 'string' } },
        { positionals: 1, usage: u },
      );
      const e = verifyTask(env, {
        taskId: taskId(positionals, u),
        cwd,
        check: requireOption(values, 'check', u),
        result: requireOption(values, 'result', u),
        executor: requireOption(values, 'executor', u),
        sha: values.sha,
      });
      out(`recorded ${e.data.check} ${e.data.result} for ${e.task_id}${e.data.sha ? ` at ${e.data.sha.slice(0, 12)}` : ''}`);
      return 0;
    }
    case 'update': {
      const u = USAGE.update;
      const { values, positionals } = parse(rest, { state: { type: 'string' }, reason: { type: 'string' }, 'waiting-on': { type: 'string' } }, { positionals: 1, usage: u });
      const e = updateTask(env, { taskId: taskId(positionals, u), state: requireOption(values, 'state', u), reason: requireOption(values, 'reason', u), waitingOn: values['waiting-on'] });
      out(`${e.task_id} ${e.event === 'task.block' ? `blocked${e.data.waiting_on ? ` (waiting on ${e.data.waiting_on})` : ''}` : 'resumed'}`);
      return 0;
    }
    case 'escalate': {
      const u = USAGE.escalate;
      const { values, positionals } = parse(rest, { kind: { type: 'string' }, reason: { type: 'string' } }, { positionals: 1, usage: u });
      const e = escalateTask(env, { taskId: taskId(positionals, u), kind: requireOption(values, 'kind', u), reason: requireOption(values, 'reason', u) });
      out(`escalated ${e.task_id}: ${e.data.kind}`);
      return 0;
    }
    case 'end': {
      const u = USAGE.end;
      const { values, positionals } = parse(rest, { outcome: { type: 'string' }, 'completed-by': { type: 'string' } }, { positionals: 1, usage: u });
      const e = endTask(env, { taskId: taskId(positionals, u), outcome: requireOption(values, 'outcome', u), completedBy: values['completed-by'] });
      out(`ended ${e.task_id}: ${e.data.outcome}`);
      await harvestAfterEnd(env, e.task_id, { out, err });
      return 0;
    }
    case 'list': {
      const { values } = parse(rest, { json: { type: 'boolean' } }, { usage: USAGE.list });
      const records = [...loadTasks(env).values()];
      if (values.json) {
        out(JSON.stringify(records.map(toContract), null, 2));
        return 0;
      }
      const human = humanStatus(env).tasks;
      for (const r of records) {
        const t = toContract(r);
        const minutes = Math.round(human.get(t.task_id)?.minutes ?? 0);
        out([t.task_id, t.project_id, t.status, t.outcome ?? '-', `human ${minutes} min`, `escalations ${r.escalations.length}`].join('\t'));
      }
      return 0;
    }
    default:
      throw usageError(`usage:\n  ${Object.values(USAGE).join('\n  ')}`);
  }
}
