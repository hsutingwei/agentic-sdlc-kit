#!/usr/bin/env node
// E2: the three profiles on eight harder tasks, to see how often an agent's own
// change is wrong and what the reviewer agent does with those changes.
//
//   node tools/experiment/e2.mjs init <dir> [--seed <n>] [--pilot]
//   node tools/experiment/e2.mjs run <dir> [--limit <n>] [--claude <path>]
//   node tools/experiment/e2.mjs check <dir>
//   node tools/experiment/e2.mjs agent-review <dir> [--limit <n>] [--claude <path>] [--model <m>] [--effort <e>] [--no-prove]
//   node tools/experiment/e2.mjs status <dir>
//   node tools/experiment/e2.mjs analyze <dir>
//
// What each command does is described in lib/cli.mjs. The plan: every task with
// every profile, twice, because a wrong change is a matter of chance and one run
// per cell cannot show a rate. `init --pilot` plans a pilot instead, in a folder
// of its own: every task once with the cheapest profile, to learn what a run
// costs and to find faults in the tasks before the runs that count. A pilot's
// runs are never part of the results.

import { pathToFileURL } from 'node:url';
import { listTaskIds } from './lib/catalogue.mjs';
import { createMain, runAsScript } from './lib/cli.mjs';
import { buildPlan } from './lib/plan.mjs';

export const TIMES = 2;
export const PILOT_PROFILE = 'pro';

export const main = createMain({
  name: 'e2',
  seed: 20261128,
  plan(seed, { pilot }) {
    const tasks = listTaskIds('e2');
    if (pilot) {
      const plan = buildPlan({ tasks, seed, profiles: [PILOT_PROFILE] });
      return { plan: { ...plan, purpose: 'pilot' }, note: `a pilot: every task once with ${PILOT_PROFILE}; its runs are not part of the results` };
    }
    const plan = buildPlan({ tasks, seed, times: TIMES });
    return { plan: { ...plan, purpose: 'results' }, note: `every task with every profile, ${TIMES} times` };
  },
});

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runAsScript(main, 'e2');
