// asdk wt new <ID> [--slug <text>] [--json]
// asdk wt finish <ID> [--gate <name>]

import { parse } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { printGateResult } from '../../governance/gate/cli.mjs';
import { finishWorktree, newWorktree } from '../lib/worktree.mjs';

const USAGE = 'asdk wt new <ID> [--slug <text>] [--json] | asdk wt finish <ID> [--gate <name>]';

export async function runWt(argv, { env, out }) {
  const [sub, ...rest] = argv;
  if (sub === 'new') {
    const { values, positionals } = parse(rest, { slug: { type: 'string' }, json: { type: 'boolean' } }, { positionals: 1, usage: USAGE });
    if (positionals.length !== 1) throw usageError(`usage: ${USAGE}`);
    const wt = newWorktree(env, { taskId: positionals[0], slug: values.slug });
    if (values.json) out(JSON.stringify(wt));
    else {
      out(`created ${wt.path}`);
      out(`branch  ${wt.branch}`);
      if (wt.copied.length) out(`copied  ${wt.copied.join(', ')}`);
    }
    return 0;
  }
  if (sub === 'finish') {
    const { values, positionals } = parse(rest, { gate: { type: 'string' } }, { positionals: 1, usage: USAGE });
    if (positionals.length !== 1) throw usageError(`usage: ${USAGE}`);
    const id = positionals[0];
    const result = finishWorktree(env, { taskId: id, gate: values.gate });
    printGateResult(result.gate, out);
    if (result.reason === 'gate') {
      out('not merged: the gate did not pass. Fix the branch in the worktree and run wt finish again.');
      return 1;
    }
    if (result.reason === 'reviews') {
      const { reviews, risk, head_sha: sha } = result;
      if (reviews.blocked) out(`not merged: a review of ${sha.slice(0, 12)} failed. Fix the branch (a new commit needs new reviews), or a human may overrule it with a passing review of this commit.`);
      else out(`not merged: ${risk.effective} risk needs ${reviews.missing.join(' and ')} of ${sha.slice(0, 12)}.`);
      out(`record a review with: asdk task verify ${id} --check review --result pass|fail --executor agent|human --sha ${sha}`);
      out('then run wt finish again; the commit stays the same while the integration branch does not move.');
      return 1;
    }
    out(`merged ${result.head_sha.slice(0, 12)} as ${result.merge_sha.slice(0, 12)}; worktree and branch removed`);
    return 0;
  }
  throw usageError(`usage: ${USAGE}`);
}
