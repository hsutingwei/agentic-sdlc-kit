#!/usr/bin/env node
// E1: compare the ultra, max and pro profiles on the same twelve tasks.
//
//   node tools/experiment/e1.mjs init <dir> [--seed <n>]
//   node tools/experiment/e1.mjs run <dir> [--pilot] [--limit <n>] [--claude <path>]
//   node tools/experiment/e1.mjs review <dir>
//   node tools/experiment/e1.mjs check <dir>
//   node tools/experiment/e1.mjs agent-review <dir> [--limit <n>] [--claude <path>] [--model <m>] [--effort <e>] [--no-prove]
//   node tools/experiment/e1.mjs status <dir>
//   node tools/experiment/e1.mjs analyze <dir>
//   node tools/experiment/e1.mjs exclude-time <dir> <run> --reason <text>
//
// What each command does is described in lib/cli.mjs. The plan: every task with
// every profile once, three tasks twice more with `max`, and one task with every
// profile first, as the pilot.

import { pathToFileURL } from 'node:url';
import { listTaskIds } from './lib/catalogue.mjs';
import { createMain, runAsScript } from './lib/cli.mjs';
import { buildPlan } from './lib/plan.mjs';

export const PILOT = 'DEMO-102';
export const REPEATS = ['DEMO-101', 'DEMO-108', 'DEMO-112'].map((task) => ({ task, profile: 'max', count: 2 }));

export const main = createMain({
  name: 'e1',
  seed: 20261125,
  plan(seed) {
    const plan = buildPlan({ tasks: listTaskIds('e1'), seed, pilot: PILOT, repeats: REPEATS });
    return { plan, note: `the first ${plan.runs.filter((r) => r.pilot).length} are the pilot (${PILOT})` };
  },
});

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runAsScript(main, 'e1');
