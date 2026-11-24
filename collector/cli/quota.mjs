// asdk quota snapshot|plan-change|status

import { parse } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { changePlan, KNOWN_WINDOWS, quotaState, recordSnapshot } from '../lib/quota.mjs';

const USAGE = {
  snapshot:
    'asdk quota snapshot --window <name>=<percent>[@<reset time>] ... [--plan <name>]\n' +
    '       asdk quota snapshot --stdin [--plan <name>]   (JSON {"plan","windows":[{"name","used_pct","resets_at"}]} or Claude Code stream-json)',
  plan: 'asdk quota plan-change --plan <name> [--at <time>]',
  status: 'asdk quota status [--json]',
};

async function readStdin(stdin = process.stdin) {
  if (stdin.isTTY) throw usageError('--stdin needs input on standard input');
  let text = '';
  stdin.setEncoding('utf8');
  for await (const chunk of stdin) text += chunk;
  return text;
}

/** "five_hour=42@2026-11-24T18:00" -> { name, used_pct, resets_at } */
function parseWindowFlag(flag) {
  const m = /^([a-z][a-z0-9_]*)=([0-9]+(?:\.[0-9]+)?)%?(?:@(.+))?$/.exec(flag);
  if (!m) throw usageError(`--window "${flag}" must look like five_hour=42 or seven_day=63@2026-11-28T09:00`);
  return { name: m[1], used_pct: Number(m[2]), resets_at: m[3] };
}

async function snapshotInput(text) {
  // Claude Code's stream-json output: one JSON object per line, one of them a rate_limit_event.
  if (/"type"\s*:\s*"rate_limit_event"/.test(text)) {
    const { windowsFromStreamJson } = await import('../../adapters/claude-code/rate-limit.mjs');
    return { windows: windowsFromStreamJson(text) ?? [], source: 'stream-json' };
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw usageError('stdin is neither JSON nor stream-json with a rate_limit_event');
  }
  const windows = Array.isArray(doc?.windows)
    ? doc.windows
    : Object.entries(doc?.windows ?? {}).map(([name, w]) => ({ name, ...(w && typeof w === 'object' ? w : { used_pct: w }) }));
  return { windows: windows.map((w) => ({ name: w?.name, used_pct: w?.used_pct, resets_at: w?.resets_at })), plan: typeof doc?.plan === 'string' ? doc.plan : undefined, source: 'json' };
}

const age = (iso) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return min < 120 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

export async function runQuota(argv, { env, out, stdin }) {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'snapshot': {
      const { values } = parse(rest, { window: { type: 'string', multiple: true }, plan: { type: 'string' }, stdin: { type: 'boolean' } }, { usage: USAGE.snapshot });
      let input;
      if (values.stdin) {
        if (values.window) throw usageError('use either --window or --stdin');
        input = await snapshotInput(await readStdin(stdin));
      } else {
        input = { windows: (values.window ?? []).map(parseWindowFlag), source: 'manual' };
      }
      const e = recordSnapshot(env, { windows: input.windows, plan: values.plan ?? input.plan, source: input.source });
      const names = Object.keys(e.data).filter((k) => k.endsWith('_pct')).map((k) => `${k.slice(0, -4)} ${e.data[k]}%`);
      out(`recorded quota snapshot (${e.data.source})${e.data.plan ? ` plan ${e.data.plan}` : ''}${names.length ? `: ${names.join(', ')}` : ''}`);
      return 0;
    }
    case 'plan-change': {
      const { values } = parse(rest, { plan: { type: 'string' }, at: { type: 'string' } }, { usage: USAGE.plan });
      if (!values.plan) throw usageError(`--plan is required\nusage: ${USAGE.plan}`);
      const e = changePlan(env, { plan: values.plan, at: values.at });
      out(`plan ${e.data.plan} from ${e.data.effective_at}`);
      return 0;
    }
    case 'status': {
      const { values } = parse(rest, { json: { type: 'boolean' } }, { usage: USAGE.status });
      const q = quotaState(env);
      if (values.json) {
        out(JSON.stringify(q));
        return 0;
      }
      if (q.plan) out(`plan: ${q.plan.plan} (from ${q.plan.effective_at})`);
      else if (q.snapshot_plan) out(`plan: ${q.snapshot_plan.plan} (seen in a snapshot ${age(q.snapshot_plan.seen_at)}; no plan change recorded)`);
      else out('plan: unknown (asdk quota plan-change --plan <name>)');
      const names = Object.keys(q.windows).sort((a, b) => (KNOWN_WINDOWS.indexOf(a) + 1 || 99) - (KNOWN_WINDOWS.indexOf(b) + 1 || 99));
      if (names.length === 0) out('no quota snapshot yet');
      for (const name of names) {
        const w = q.windows[name];
        const reset = w.resets_at ? `, resets ${w.resets_at}${Date.parse(w.resets_at) < Date.now() ? ' (already reset: value is stale)' : ''}` : '';
        out(`${name}\t${w.used_pct}%\trecorded ${age(w.recorded_at)} (${w.source})${reset}`);
      }
      return 0;
    }
    default:
      throw usageError(`usage:\n  ${Object.values(USAGE).join('\n  ')}`);
  }
}
