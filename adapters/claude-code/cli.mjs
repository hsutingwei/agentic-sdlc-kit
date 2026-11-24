// asdk hooks install|uninstall|status

import { parse } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { HOOK_EVENTS, inspectHooks, installHooks, uninstallHooks } from './install.mjs';

const COMMON = { scope: { type: 'string' }, project: { type: 'string' } };
const USAGE = {
  install: 'asdk hooks install [--scope user|local] [--project <dir>] [--dry-run]',
  uninstall: 'asdk hooks uninstall [--scope user|local] [--project <dir>] [--dry-run] [--all]',
  status: 'asdk hooks status [--scope user|local] [--project <dir>] [--json]',
};

export async function runHooks(argv, { env, cwd, out, err }) {
  const [sub, ...rest] = argv;
  if (sub === 'install') {
    const { values } = parse(rest, { ...COMMON, 'dry-run': { type: 'boolean' } }, { usage: USAGE.install });
    const r = installHooks(env, { scope: values.scope, project: values.project, cwd, dryRun: values['dry-run'] });
    if (!r.changed) out(`already installed in ${r.file}`);
    else out(`${r.dryRun ? 'would add' : 'added'} ${r.added.length} hook event(s) to ${r.file}${r.note ? ` (${r.note})` : ''}: ${r.added.join(', ')}`);
    if (r.stale > 0) err(`note: ${r.stale} kit hook entr${r.stale === 1 ? 'y points' : 'ies point'} at another command; \`asdk hooks uninstall --all\` removes them`);
    return 0;
  }
  if (sub === 'uninstall') {
    const { values } = parse(rest, { ...COMMON, 'dry-run': { type: 'boolean' }, all: { type: 'boolean' } }, { usage: USAGE.uninstall });
    const r = uninstallHooks(env, { scope: values.scope, project: values.project, cwd, dryRun: values['dry-run'], all: values.all });
    if (!r.changed) out(`nothing to remove in ${r.file}`);
    else if (r.deletedFile) out(`${r.dryRun ? 'would delete' : 'deleted'} ${r.file}: install had created it and nothing else is in it`);
    else out(`${r.dryRun ? 'would remove' : 'removed'} ${r.removed} hook entr${r.removed === 1 ? 'y' : 'ies'} from ${r.file}${r.note ? ` (${r.note})` : ''}`);
    if (r.changed && !r.manifest) err('note: no install record was found, so containers that are now empty were left in place');
    return 0;
  }
  if (sub === 'status') {
    const { values } = parse(rest, { ...COMMON, json: { type: 'boolean' } }, { usage: USAGE.status });
    const r = inspectHooks(env, { scope: values.scope, project: values.project, cwd });
    if (values.json) {
      out(JSON.stringify(r));
    } else {
      out(`settings: ${r.file}${r.exists ? '' : ' (missing)'}`);
      if (r.error) out(`error: ${r.error}`);
      out(`installed: ${r.installed.length}/${HOOK_EVENTS.length}${r.missing.length ? ` (missing: ${r.missing.join(', ')})` : ''}`);
      if (r.duplicates) out(`duplicates: ${r.duplicates}`);
      if (r.stale) out(`entries for another kit command: ${r.stale}`);
    }
    return r.error ? 2 : r.missing.length ? 1 : 0;
  }
  throw usageError(`usage: ${USAGE.install}\n       ${USAGE.uninstall}\n       ${USAGE.status}`);
}
