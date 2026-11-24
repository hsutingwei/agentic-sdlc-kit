// asdk verify run [<scenario>] [--task <ID>] [--record] [--json]
// asdk verify list

import { parse } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { repoInfo } from '../../core/git.mjs';
import { loadScenarios, loadVerifyConfig, runVerify } from './verify.mjs';

const RUN = 'asdk verify run [<scenario>] [--task <ID>] [--record] [--json]';
const USAGE = `${RUN} | asdk verify list`;

export async function runVerifyCommand(argv, { env, cwd, out }) {
  const [sub, ...rest] = argv;
  if (sub === 'list') {
    parse(rest, {}, { usage: 'asdk verify list' });
    const top = repoInfo(cwd, env)?.toplevel;
    if (!top) throw usageError('not inside a git repository');
    const config = loadVerifyConfig(top);
    for (const s of loadScenarios(top, config)) out(`${s.name}\t${s.scenario.description ?? ''}`);
    return 0;
  }
  if (sub !== 'run') throw usageError(`usage: ${USAGE}`);
  const { values, positionals } = parse(rest, { task: { type: 'string' }, record: { type: 'boolean' }, json: { type: 'boolean' } }, { positionals: 1, usage: RUN });
  const run = await runVerify(env, { cwd, scenario: positionals[0], taskId: values.task, record: values.record });
  if (values.json) {
    out(JSON.stringify({ result: run.result, file: run.file, sha256: run.sha256, recorded: run.recorded, evidence: run.evidence }));
  } else {
    const e = run.evidence;
    out(`verify on ${e.head_sha.slice(0, 12)}${e.tree_clean ? '' : ' (uncommitted changes present)'}`);
    if (e.launch_problem) out(`  ERROR   launch: ${e.launch_problem}`);
    for (const s of e.scenarios) {
      out(`  ${s.result.toUpperCase().padEnd(7)} ${s.name}${s.criteria ? ` (${s.criteria.join(', ')})` : ''}`);
      for (const step of s.steps.filter((x) => x.result !== 'pass')) out(`          ${step.result} ${step.name}${step.reason ? `: ${step.reason}` : ''}`);
    }
    if (e.launch_problem && e.server_log_tail.length) {
      out('--- last lines the application printed:');
      for (const line of e.server_log_tail) out(line);
    }
    out(`evidence: ${run.file}`);
    out(`sha256:   ${run.sha256}`);
    out(`result: ${run.result}${run.recorded ? ` (recorded as ${e.check} on ${e.task_id})` : ''}`);
  }
  return run.result === 'pass' ? 0 : 1;
}
