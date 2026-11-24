// asdk human start|stop|adjust|status

import { parse, requireOption } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { adjustHuman, humanStatus, startHuman, stopHuman } from '../lib/human.mjs';

const USAGE = {
  start: 'asdk human start <ID> [--activity <spec|review|fix|acceptance|other>] [--switch]',
  stop: 'asdk human stop [<ID>]',
  adjust: 'asdk human adjust <ID> --minutes <±N> --reason <text> [--activity <spec|review|fix|acceptance|other>]',
  status: 'asdk human status [--json]',
};

const fmt = (minutes) => `${Math.round(minutes)} min`;

export async function runHuman(argv, { env, out }) {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'start': {
      const { values, positionals } = parse(rest, { activity: { type: 'string' }, switch: { type: 'boolean' } }, { positionals: 1, usage: USAGE.start });
      if (positionals.length !== 1) throw usageError(`usage: ${USAGE.start}`);
      const { started, stopped } = startHuman(env, { taskId: positionals[0], activity: values.activity, switchTask: values.switch });
      if (stopped) out(`stopped the timer for ${stopped.task_id}`);
      out(`timing ${started.task_id} (${started.data.activity}) from ${started.ts}`);
      return 0;
    }
    case 'stop': {
      const { positionals } = parse(rest, {}, { positionals: 1, usage: USAGE.stop });
      const { event, since, activity } = stopHuman(env, { taskId: positionals[0] });
      out(`stopped ${event.task_id} (${activity}): ${fmt((Date.parse(event.ts) - Date.parse(since)) / 60000)}`);
      return 0;
    }
    case 'adjust': {
      const { values, positionals } = parse(rest, { minutes: { type: 'string' }, reason: { type: 'string' }, activity: { type: 'string' } }, { positionals: 1, usage: USAGE.adjust });
      if (positionals.length !== 1) throw usageError(`usage: ${USAGE.adjust}`);
      const raw = requireOption(values, 'minutes', USAGE.adjust);
      if (!/^[+-]?\d+(\.\d+)?$/.test(raw)) throw usageError('--minutes must be a number such as 15 or -10');
      const e = adjustHuman(env, { taskId: positionals[0], minutes: Number(raw), activity: values.activity, reason: requireOption(values, 'reason', USAGE.adjust) });
      out(`adjusted ${e.task_id} by ${e.data.minutes > 0 ? '+' : ''}${e.data.minutes} min (${e.data.activity})`);
      return 0;
    }
    case 'status': {
      const { values } = parse(rest, { json: { type: 'boolean' } }, { usage: USAGE.status });
      const { open, tasks } = humanStatus(env);
      if (values.json) {
        const perTask = Object.fromEntries([...tasks].map(([id, r]) => [id, { minutes: r.minutes, by_activity: r.by_activity, flags: [...r.flags] }]));
        out(JSON.stringify({ open, tasks: perTask }));
        return 0;
      }
      out(open ? `running: ${open.task_id} (${open.activity}) since ${open.since}` : 'no timer running');
      for (const [id, r] of tasks) {
        const parts = Object.entries(r.by_activity).map(([a, m]) => `${a} ${fmt(m)}`);
        out(`${id}\t${fmt(r.minutes)}\t${parts.join(', ')}${r.flags.size ? `\t[${[...r.flags].join(', ')}]` : ''}`);
      }
      return 0;
    }
    default:
      throw usageError(`usage:\n  ${Object.values(USAGE).join('\n  ')}`);
  }
}
