// asdk rules test | check [--json]

import { parse } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { repoInfo } from '../../core/git.mjs';
import { checkRules, loadRules, RULES_FILE, testRules } from './rules.mjs';

const USAGE = 'asdk rules test|check [--json]';

export async function runRules(argv, { env, cwd, out }) {
  const [sub, ...rest] = argv;
  if (sub !== 'test' && sub !== 'check') throw usageError(`usage: ${USAGE}`);
  const { values } = parse(rest, { json: { type: 'boolean' } }, { usage: USAGE });
  const top = repoInfo(cwd, env)?.toplevel;
  if (!top) throw usageError('not inside a git repository');
  const rules = loadRules(top);
  if (rules.length === 0) {
    out(values.json ? '[]' : `no rules in ${RULES_FILE}`);
    return 0;
  }
  if (sub === 'test') {
    const results = testRules(rules);
    if (values.json) out(JSON.stringify(results));
    else for (const r of results) out(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id}${r.ok ? '' : `\n     ${r.problems.join('\n     ')}`}`);
    return results.every((r) => r.ok) ? 0 : 1;
  }
  const findings = checkRules(rules, { cwd: top, env });
  if (values.json) out(JSON.stringify(findings));
  else {
    for (const f of findings) out(`${f.file}:${f.line}  [${f.id}] ${f.message}\n    ${f.text}`);
    out(`${rules.length} rule(s), ${findings.length} finding(s)`);
  }
  return findings.length ? 1 : 0;
}
