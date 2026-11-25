#!/usr/bin/env node
// E1: compare the ultra, max and pro profiles on the same tasks.
//
//   node tools/experiment/e1.mjs init <dir> [--seed <n>]
//   node tools/experiment/e1.mjs run <dir> [--pilot] [--limit <n>] [--claude <path>]
//   node tools/experiment/e1.mjs review <dir>
//   node tools/experiment/e1.mjs status <dir>
//   node tools/experiment/e1.mjs analyze <dir>
//
// `run` uses your Claude Code subscription; it stops by itself when a quota window
// is nearly full and continues where it stopped the next time. `review` needs you:
// one change at a time, without the profile, timed.

import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { writeAnalysis } from './lib/analyze.mjs';
import { listTaskIds } from './lib/catalogue.mjs';
import { buildPlan, loadPlan, readLog, runStates, savePlan } from './lib/plan.mjs';
import { beginReview, completeReview, pauseReview, pendingReviews, reviewMaterial } from './lib/review.mjs';
import { executeRun, quotaAllows, writeShims } from './lib/run.mjs';

export const PILOT = 'DEMO-102';
export const REPEATS = ['DEMO-101', 'DEMO-108', 'DEMO-112'].map((task) => ({ task, profile: 'max', count: 2 }));
const USAGE = 'usage: e1.mjs init|run|review|status|analyze <dir> [options]';

function defaultClaude() {
  const local = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return existsSync(local) ? local : 'claude';
}

function lastQuota(dir) {
  const withQuota = readLog(dir).filter((r) => r.quota && Object.keys(r.quota).length);
  return withQuota.at(-1)?.quota ?? {};
}

export async function main(argv, { out = console.log, input = process.stdin, output = process.stdout, baseEnv = process.env } = {}) {
  const [command, dirArg, ...rest] = argv;
  if (!command || !dirArg) throw new Error(USAGE);
  const dir = path.resolve(dirArg);
  const { values } = parseArgs({
    args: rest,
    options: { seed: { type: 'string' }, pilot: { type: 'boolean' }, limit: { type: 'string' }, claude: { type: 'string' } },
    strict: true,
  });

  if (command === 'init') {
    const seed = values.seed === undefined ? 20261125 : Number(values.seed);
    if (!Number.isInteger(seed)) throw new Error('--seed must be a whole number');
    const plan = buildPlan({ tasks: listTaskIds(), seed, pilot: PILOT, repeats: REPEATS });
    savePlan(dir, plan);
    writeShims(dir);
    out(`planned ${plan.runs.length} runs in ${dir} (seed ${seed}); the first ${plan.runs.filter((r) => r.pilot).length} are the pilot (${PILOT})`);
    return 0;
  }

  const plan = loadPlan(dir);
  const states = runStates(dir);

  if (command === 'status') {
    const counts = {};
    for (const r of plan.runs) {
      const stage = states.get(r.run)?.stage ?? 'planned';
      counts[stage] = (counts[stage] ?? 0) + 1;
    }
    out(`${plan.runs.length} planned: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const q = lastQuota(dir);
    if (Object.keys(q).length) out(`last quota seen: ${Object.entries(q).map(([k, v]) => `${k} ${v}%`).join(', ')}`);
    const stuck = [...states.values()].filter((s) => s.stage === 'started');
    if (stuck.length) out(`interrupted before the gate (not counted): ${stuck.map((s) => s.run).join(', ')}`);
    return 0;
  }

  if (command === 'run') {
    const chosen = values.claude ?? defaultClaude();
    // A .mjs or .js file is a stand-in agent run with node (the tests use one).
    const claude = /\.m?js$/.test(chosen) ? { command: process.execPath, args: [chosen] } : { command: chosen, args: [] };
    const limit = values.limit === undefined ? Infinity : Number(values.limit);
    let done = 0;
    for (const planned of plan.runs) {
      if (done >= limit) break;
      if (values.pilot && !planned.pilot) break;
      if (states.has(planned.run)) continue;
      const allowed = quotaAllows(lastQuota(dir));
      if (!allowed.ok) {
        out(`stopped: ${allowed.over.join(', ')}. Run again after the window resets; finished runs are kept.`);
        return 0;
      }
      out(`${planned.run} ${planned.task}: running`);
      const rec = executeRun(dir, planned, { baseEnv, claude });
      const cost = rec.attempts.reduce((n, a) => n + (a.result?.total_cost_usd ?? 0), 0);
      out(`${planned.run} ${planned.task}: gate ${rec.gate_failed ? 'failed twice' : rec.first_gate === 'pass' ? 'passed' : 'passed on retry'}, ${rec.attempts.length} attempt(s), list price USD ${cost.toFixed(2)}, quota ${Object.entries(rec.quota).map(([k, v]) => `${k} ${v}%`).join(' ') || 'unknown'}`);
      done++;
    }
    out(`${done} run(s) finished this time; review them with: node tools/experiment/e1.mjs review "${dir}"`);
    return 0;
  }

  if (command === 'review') {
    // Lines are read through the async iterator, which keeps answers typed (or piped) ahead.
    const rl = readline.createInterface({ input, terminal: false });
    const lines = rl[Symbol.asyncIterator]();
    const ask = async (prompt, atEnd) => {
      output.write(prompt);
      const next = await lines.next();
      return next.done ? atEnd : next.value;
    };
    try {
      const pending = pendingReviews(dir);
      for (const [i, state] of pending.entries()) {
        const m = reviewMaterial(dir, state, { baseEnv });
        const diffFile = path.join(dir, 'review-current.diff');
        writeFileSync(diffFile, m.diff);
        out(`\n=== Review ${i + 1} of ${pending.length} (the profile is not shown) ===`);
        out(`${m.title}\n${m.goal}`);
        for (const c of m.criteria) out(`  ${c.id}: ${c.text}`);
        out(`gate: ${m.gate}${m.merged ? '; already merged (low risk)' : ''}`);
        out(`the change is also in ${diffFile}`);
        const ready = await ask('Press Enter to show the change and start the timer, or q to stop: ', 'q');
        if (ready.trim().toLowerCase() === 'q') break;
        beginReview(dir, state, { baseEnv });
        out(m.screen || '(nothing was committed)');
        let decision = null;
        while (!decision) {
          const a = (await ask(m.can_accept ? '[a]ccept, [r]eject, or [p]ause: ' : '[r]eject or [p]ause (the gate failed twice): ', 'p')).trim().toLowerCase();
          if (a === 'a' && m.can_accept) decision = 'accept';
          else if (a === 'r') decision = 'reject';
          else if (a === 'p') decision = 'pause';
        }
        if (decision === 'pause') {
          pauseReview(dir, state, { baseEnv });
          out('paused; the time so far is kept');
          break;
        }
        const note = await ask('Note for yourself (optional, kept local): ', '');
        const r = completeReview(dir, state, { decision, note: note.trim() || undefined }, { baseEnv });
        out(`${decision}ed after ${r.review_minutes} min${r.hidden ? `; hidden tests ${r.hidden.result}` : ''}`);
      }
      out(`${pendingReviews(dir).length} review(s) left`);
    } finally {
      rl.close();
    }
    return 0;
  }

  if (command === 'analyze') {
    const { rows, files } = writeAnalysis(dir);
    out(`${rows.length} finished run(s) analysed:\n  ${Object.values(files).join('\n  ')}`);
    return 0;
  }

  throw new Error(USAGE);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`e1: ${err.message}`);
      process.exitCode = 2;
    },
  );
}
