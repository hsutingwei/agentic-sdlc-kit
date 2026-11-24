// asdk push-check [--project <id>] [--limit N] [--json]
// asdk push-check install-hook | remove-hook [--project <id>]
// asdk push-check record <remote> [<url>]      (run by the pre-push hook; reads refs on stdin)

import { fileURLToPath } from 'node:url';
import { parse } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { checkPushes, installPushHook, recordPush, removePushHook } from '../lib/push-check.mjs';

const ASDK = fileURLToPath(new URL('../../bin/asdk.mjs', import.meta.url));
const USAGE = 'asdk push-check [--project <id>] [--limit <n>] [--json] | asdk push-check install-hook|remove-hook [--project <id>]';

async function readStdin() {
  if (process.stdin.isTTY) return '';
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

export async function runPushCheck(argv, { env, cwd, out, err }) {
  const [sub, ...rest] = argv;
  if (sub === 'record') {
    // From the pre-push hook. It refuses a push only when block is on and it found no
    // passing run; if the check itself breaks, the push goes ahead with a warning.
    try {
      const [remote] = rest;
      const { warnings, refused } = recordPush(env, { cwd, remote, refsText: await readStdin() });
      for (const w of warnings) err(`asdk push-check: warning: ${w}`);
      if (refused.length) {
        for (const r of refused) err(`asdk push-check: ${r}`);
        err('asdk push-check: push refused (push_check.block is on in .asdk/gates.json).');
        err('A human can still push with "git push --no-verify"; asdk push-check then shows the commit as missing.');
        return 1;
      }
    } catch (e) {
      err(`asdk push-check: could not check the push (${e.message}); not blocking it`);
    }
    return 0;
  }
  if (sub === 'install-hook' || sub === 'remove-hook') {
    const { values } = parse(rest, { project: { type: 'string' } }, { usage: USAGE });
    if (sub === 'install-hook') out(`installed ${installPushHook(env, { projectId: values.project, cwd, asdk: ASDK })}`);
    else {
      const file = removePushHook(env, { projectId: values.project, cwd });
      out(file ? `removed ${file}` : 'no pre-push hook installed');
    }
    return 0;
  }
  const { values } = parse(sub === undefined ? [] : argv, { project: { type: 'string' }, limit: { type: 'string' }, json: { type: 'boolean' } }, { usage: USAGE });
  const limit = values.limit === undefined ? 50 : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1) throw usageError('--limit must be a positive whole number');
  const r = checkPushes(env, { projectId: values.project, cwd, limit });
  if (values.json) {
    out(JSON.stringify(r));
    return 0;
  }
  out(`${r.project_id}: ${r.branch} checked against ${r.gate}`);
  for (const c of r.commits) {
    const when = c.pushed_at ? `${c.pushed_at}${c.push_time_source === 'reflog' ? ' (approx.)' : ''}` : 'push time unknown';
    out(`${c.sha.slice(0, 12)}\t${c.status}\t${when}\t${c.runs} run(s)`);
  }
  out(Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join(', '));
  return 0;
}
