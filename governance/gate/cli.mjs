// asdk gate run <GATE> [--task ID] [--record] [--runner id] [--json]
// asdk gate list

import { parse } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { repoInfo } from '../../core/git.mjs';
import { loadGateConfig, runGate } from './gate.mjs';

const RUN_USAGE = 'asdk gate run <GATE> [--task <ID>] [--record] [--runner <id>] [--json]';
const TAIL_LINES = 40;

export function printGateResult({ summary, outputs, risk_matches: matches = [] }, out) {
  out(`gate ${summary.gate} on ${summary.head_sha.slice(0, 12)}${summary.tree_clean ? '' : ' (uncommitted changes present)'}`);
  const { declared, effective } = summary.risk;
  if (matches.length && effective !== declared) {
    out(`risk: ${declared ? `${declared} raised to ` : ''}${effective} by changed paths (.asdk/risk-paths.json):`);
    for (const m of matches.slice(0, 10)) out(`  ${m.risk.padEnd(8)} ${m.path}${m.reason ? ` - ${m.reason}` : ''}`);
  }
  for (const s of summary.steps) out(`  ${s.result.toUpperCase().padEnd(7)} ${s.name}${s.result === 'skipped' ? '' : ` (${s.duration_ms} ms)`}`);
  const failed = summary.steps.find((s) => s.result === 'fail' || s.result === 'error');
  if (failed) {
    const lines = (outputs[failed.name] ?? '').trimEnd().split(/\r?\n/);
    out(`--- last ${Math.min(lines.length, TAIL_LINES)} lines of "${failed.name}":`);
    for (const line of lines.slice(-TAIL_LINES)) out(line);
  }
  out(`result: ${summary.result}`);
}

export async function runGateCommand(argv, { env, cwd, out }) {
  const [sub, ...rest] = argv;
  if (sub === 'list') {
    parse(rest, {}, { usage: 'asdk gate list' });
    const repo = repoInfo(cwd, env);
    if (!repo) throw usageError('not inside a git repository');
    for (const [name, g] of Object.entries(loadGateConfig(repo.toplevel).gates)) out(`${name}\t${g.description ?? ''}`);
    return 0;
  }
  if (sub !== 'run') throw usageError(`usage: ${RUN_USAGE} | asdk gate list`);
  const { values, positionals } = parse(
    rest,
    { task: { type: 'string' }, record: { type: 'boolean' }, runner: { type: 'string' }, json: { type: 'boolean' } },
    { positionals: 1, usage: RUN_USAGE },
  );
  if (positionals.length !== 1) throw usageError(`usage: ${RUN_USAGE}`);
  const run = runGate(env, { gate: positionals[0], cwd, taskId: values.task, record: values.record, runner: values.runner });
  if (values.json) out(JSON.stringify(run.summary, null, 2));
  else printGateResult(run, out);
  return run.summary.result === 'pass' ? 0 : 1;
}
