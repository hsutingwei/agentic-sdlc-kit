// asdk profile show [--plan <plan> | --profile <name>] [--role <role>] [--risk <level>] [--json | --format claude-args]
// asdk profile apply [--plan <plan> | --profile <name>] [--risk <level>] [--dry-run]

import { parse } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { repoInfo } from '../../core/git.mjs';
import { RISKS } from '../../collector/lib/tasks.mjs';
import { applyToAgents } from '../../adapters/claude-code/agents.mjs';
import { claudeArgs, loadProfiles, resolveRole, selectProfile } from './profiles.mjs';

const SHOW = 'asdk profile show [--plan <plan> | --profile <name>] [--role <role>] [--risk <level>] [--json | --format claude-args]';
const APPLY = 'asdk profile apply [--plan <plan> | --profile <name>] [--risk <level>] [--dry-run]';
const USAGE = `${SHOW} | ${APPLY}`;

/** Writes the profile's model and effort into the project's sub-agent definitions. */
function runApply(rest, { env, cwd, out }) {
  const { values } = parse(rest, { plan: { type: 'string' }, profile: { type: 'string' }, risk: { type: 'string' }, 'dry-run': { type: 'boolean' } }, { usage: APPLY });
  const { top, selected } = profileContext(env, cwd, values);
  if (!top) throw usageError('not inside a git repository');
  const risk = values.risk ?? 'low';
  if (!RISKS.includes(risk)) throw usageError(`--risk must be one of ${RISKS.join(', ')}`);
  const results = applyToAgents(top, (role) => (Object.hasOwn(selected.profile.roles, role) ? resolveRole(selected.profile, role, risk) : null), { dryRun: values['dry-run'] });
  if (results.length === 0) {
    out('no sub-agent definitions in .claude/agents');
    return 0;
  }
  const verb = values['dry-run'] ? 'would set' : 'set';
  for (const r of results) {
    if (!r.to) out(`skipped   ${r.file} (${r.role ? `no role "${r.role}" in profile ${selected.name}` : 'no name in its frontmatter'})`);
    else if (!r.changed) out(`ok        ${r.file} already ${r.to.model}, ${r.to.effort}`);
    else out(`${verb.padEnd(9)} ${r.file}: model ${r.from.model ?? '(none)'} -> ${r.to.model}, effort ${r.from.effort ?? '(none)'} -> ${r.to.effort}`);
  }
  out(`profile ${selected.name}, ${risk} risk${values['dry-run'] ? '; nothing written (--dry-run)' : ''}`);
  return 0;
}

const SOURCES = { profile: 'chosen with --profile', plan: 'from --plan', 'plan-change': 'from the latest plan change' };

export function profileContext(env, cwd, values) {
  if (values.plan !== undefined && values.profile !== undefined) throw usageError('pass --plan or --profile, not both');
  const top = repoInfo(cwd, env)?.toplevel;
  const profiles = loadProfiles(top);
  return { top, profiles, selected: selectProfile(env, profiles, { plan: values.plan, profile: values.profile }) };
}

export async function runProfile(argv, { env, cwd, out }) {
  const [sub, ...rest] = argv;
  if (sub === 'apply') return runApply(rest, { env, cwd, out });
  if (sub !== 'show') throw usageError(`usage: ${USAGE}`);
  const { values } = parse(
    rest,
    { plan: { type: 'string' }, profile: { type: 'string' }, role: { type: 'string' }, risk: { type: 'string' }, json: { type: 'boolean' }, format: { type: 'string' } },
    { usage: SHOW },
  );
  if (values.format !== undefined && values.format !== 'claude-args') throw usageError('--format must be claude-args');
  if (values.format && values.json) throw usageError('pass --json or --format, not both');
  const { selected } = profileContext(env, cwd, values);
  const { profile } = selected;

  if (values.format === 'claude-args') {
    if (!values.role) throw usageError('--format claude-args needs --role');
    out(claudeArgs(resolveRole(profile, values.role, values.risk)).join(' '));
    return 0;
  }
  const roles = values.role ? [values.role] : Object.keys(profile.roles);
  const risks = values.risk ? [values.risk] : RISKS;
  const rows = roles.flatMap((role) => risks.map((risk) => resolveRole(profile, role, risk)));
  if (values.json) {
    out(JSON.stringify({ profile: selected.name, plan: selected.plan, source: selected.source, verifiers: profile.verifiers, roles: rows }));
    return 0;
  }
  out(`profile ${selected.name}${selected.plan ? ` (plan ${selected.plan}, ${SOURCES[selected.source]})` : ` (${SOURCES[selected.source]})`}`);
  if (profile.description) out(profile.description);
  out('');
  out(`${'role'.padEnd(13)}${'risk'.padEnd(10)}${'model'.padEnd(10)}${'effort'.padEnd(8)}isolation`);
  for (const r of rows) out(`${r.role.padEnd(13)}${r.risk.padEnd(10)}${r.model.padEnd(10)}${r.effort.padEnd(8)}${r.isolation}`);
  out('');
  out(`verifiers: ${risks.map((risk) => `${risk} ${profile.verifiers[risk]}`).join(', ')}`);
  return 0;
}
