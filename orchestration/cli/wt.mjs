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
    const result = finishWorktree(env, { taskId: positionals[0], gate: values.gate ?? 'G1' });
    printGateResult(result.gate, out);
    if (!result.merged) {
      out('not merged: the gate did not pass. Fix the branch in the worktree and run wt finish again.');
      return 1;
    }
    out(`merged ${result.head_sha.slice(0, 12)} as ${result.merge_sha.slice(0, 12)}; worktree and branch removed`);
    return 0;
  }
  throw usageError(`usage: ${USAGE}`);
}
