// asdk usage [--task <ID> | --session <id>] [--json]

import { parse } from '../../core/cli.mjs';
import { ruleError, usageError } from '../../core/errors.mjs';
import { readEvents } from '../lib/store.mjs';
import { deriveTasks } from '../lib/tasks.mjs';
import { harvestedSessions, summarizeUsage } from '../lib/usage.mjs';

const USAGE = 'asdk usage [--task <ID> | --session <id>] [--json]';

const fmt = (n) => n.toLocaleString('en-US');
const line = (label, t) => `${label}\t${t.responses} resp\tin ${fmt(t.input_tokens)}\tout ${fmt(t.output_tokens)}\tcache write ${fmt(t.cache_write_tokens)}\tcache read ${fmt(t.cache_read_tokens)}`;

export async function runUsage(argv, { env, out }) {
  const { values } = parse(argv, { task: { type: 'string' }, session: { type: 'string' }, json: { type: 'boolean' } }, { usage: USAGE });
  if (values.task && values.session) throw usageError(`usage: ${USAGE}`);
  let ids;
  if (values.session) ids = [values.session];
  else if (values.task) {
    const task = deriveTasks(readEvents(env).events).tasks.get(values.task);
    if (!task) throw ruleError(`task ${values.task} has not been started`);
    ids = [...task.sessions].sort();
  } else ids = harvestedSessions(env);

  const s = summarizeUsage(env, ids);
  if (values.json) {
    out(JSON.stringify(s));
    return 0;
  }
  out(line('total', s.total));
  for (const [model, t] of Object.entries(s.by_model).sort()) out(line(`model ${model}`, t));
  for (const [type, t] of Object.entries(s.by_agent_type).sort()) out(line(`agent ${type}`, t));
  out(`sessions ${s.sessions}; tool results ${s.tool_results.count} (${fmt(s.tool_results.bytes)} bytes)`);
  if (s.missing.length) out(`not harvested: ${s.missing.join(', ')} (asdk harvest)`);
  if (s.invalid.length) out(`damaged usage files: ${s.invalid.join(', ')} (delete them and harvest again)`);
  if (s.unreadable_records) out(`note: ${s.unreadable_records} transcript record(s) could not be read; totals are partial`);
  return 0;
}
