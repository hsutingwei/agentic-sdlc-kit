// Reading a task brief, briefs/<TASK-ID>.json, as it is in one commit.
//
// The reviewer reads the brief of the commit it reviews; the merge gate reads the
// brief of the integration branch, so a task branch cannot widen its own scope.

import { ruleError } from '../../core/errors.mjs';
import { tryGit } from '../../core/git.mjs';
import { validateContract } from '../../core/validate.mjs';

const BOM = String.fromCharCode(0xfeff);

export const briefPath = (taskId) => `briefs/${taskId}.json`;

/**
 * The brief of `taskId` in `ref`, or null when that commit has none. A brief that is
 * there must be valid JSON, a valid task brief, and the brief of that task.
 * @returns {{ text: string, brief: object } | null}
 */
export function readBrief(env, { repo, ref, taskId }) {
  const rel = briefPath(taskId);
  const shown = tryGit(['show', `${ref}:${rel}`], { cwd: repo, env });
  if (!shown.ok) return null;
  let brief;
  try {
    brief = JSON.parse(shown.stdout.startsWith(BOM) ? shown.stdout.slice(1) : shown.stdout);
  } catch (err) {
    throw ruleError(`${rel} is not valid JSON: ${err.message}`);
  }
  const check = validateContract('task-brief', brief);
  if (!check.valid) throw ruleError(`${rel} is not a valid task brief: ${check.errors[0].path} ${check.errors[0].message}`);
  if (brief.task_id !== taskId) throw ruleError(`${rel} is the brief of ${brief.task_id}, not ${taskId}`);
  return { text: shown.stdout, brief };
}
