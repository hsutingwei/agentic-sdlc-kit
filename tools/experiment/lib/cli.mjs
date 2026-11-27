// The command line every experiment shares. An experiment is a suite of tasks and
// a way to plan its runs; e1.mjs and e2.mjs each give theirs to createMain.
//
//   init <dir> [--seed <n>]
//   run <dir> [--pilot] [--limit <n>] [--claude <path>]
//   review <dir>
//   check <dir>
//   agent-review <dir> [--limit <n>] [--claude <path>] [--model <m>] [--effort <e>] [--no-prove]
//   status <dir>
//   analyze <dir>
//   exclude-time <dir> <run> --reason <text>
//
// `run` uses your Claude Code subscription; it stops by itself when a quota window
// is nearly full and continues where it stopped the next time. `review` needs you:
// one change at a time, without the profile, timed. `check` needs nobody: it runs
// each task's hidden tests on the commit its run left, without merging anything.
// `agent-review` uses your subscription too: one sterile reviewer agent per run,
// the same reviewer for every profile, stopping near the quota limit like `run`.

import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { writeAnalysis } from './analyze.mjs';
import { loadPlan, readLog, runStates, savePlan } from './plan.mjs';
import { findClaude } from '../../../adapters/claude-code/sterile.mjs';
import { agentReviewRun, checkRun, committedRuns, pendingAgentReviews, pendingChecks } from './retro.mjs';
import { beginReview, completeReview, excludeReviewTime, pauseReview, pendingReviews, reviewMaterial } from './review.mjs';
import { executeRun, quotaAllows, writeShims } from './run.mjs';

function defaultClaude() {
  const local = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return existsSync(local) ? local : 'claude';
}

function lastQuota(dir) {
  const seen = readLog(dir).map((r) => r.agent_review?.quota ?? r.quota).filter((q) => q && Object.keys(q).length);
  return seen.at(-1) ?? {};
}

/**
 * @param {object} suite
 * @param {string} suite.name      the suite's name, as plan.json records it: 'e1'
 * @param {number} suite.seed      the seed `init` uses when none is given
 * @param {object} [suite.options] options of `init` that only this suite has (parseArgs)
 * @param {(seed: number, values: object) => { plan: object, note: string }} suite.plan
 */
export function createMain(suite) {
  const script = `${suite.name}.mjs`;
  const usage = `usage: ${script} init|run|review|check|agent-review|status|analyze|exclude-time <dir> [options]`;

  return async function main(argv, { out = console.log, input = process.stdin, output = process.stdout, baseEnv = process.env } = {}) {
    const [command, dirArg, ...rest] = argv;
    if (!command || !dirArg) throw new Error(usage);
    const dir = path.resolve(dirArg);
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        seed: { type: 'string' },
        pilot: { type: 'boolean' },
        limit: { type: 'string' },
        claude: { type: 'string' },
        reason: { type: 'string' },
        model: { type: 'string' },
        effort: { type: 'string' },
        'no-prove': { type: 'boolean' },
        ...(command === 'init' ? suite.options : undefined),
      },
      allowPositionals: command === 'exclude-time',
      strict: true,
    });

    if (command === 'init') {
      const seed = values.seed === undefined ? suite.seed : Number(values.seed);
      if (!Number.isInteger(seed)) throw new Error('--seed must be a whole number');
      const { plan, note } = suite.plan(seed, values);
      savePlan(dir, { suite: suite.name, ...plan });
      writeShims(dir);
      out(`planned ${plan.runs.length} runs in ${dir} (seed ${seed})${note ? `; ${note}` : ''}`);
      return 0;
    }

    const plan = loadPlan(dir);
    const planned = plan.suite ?? 'e1';
    if (planned !== suite.name) throw new Error(`${dir} holds an ${planned} experiment; use ${planned}.mjs`);
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
      if (values.pilot && !plan.runs.some((r) => r.pilot)) throw new Error('this plan has no pilot runs of its own');
      const chosen = values.claude ?? defaultClaude();
      // A .mjs or .js file is a stand-in agent run with node (the tests use one).
      const claude = /\.m?js$/.test(chosen) ? { command: process.execPath, args: [chosen] } : { command: chosen, args: [] };
      const limit = values.limit === undefined ? Infinity : Number(values.limit);
      let done = 0;
      for (const next of plan.runs) {
        if (done >= limit) break;
        if (values.pilot && !next.pilot) break;
        if (states.has(next.run)) continue;
        const allowed = quotaAllows(lastQuota(dir));
        if (!allowed.ok) {
          out(`stopped: ${allowed.over.join(', ')}. Run again after the window resets; finished runs are kept.`);
          return 0;
        }
        out(`${next.run} ${next.task}: running`);
        const rec = executeRun(dir, next, { baseEnv, claude });
        const cost = rec.attempts.reduce((n, a) => n + (a.result?.total_cost_usd ?? 0), 0);
        out(`${next.run} ${next.task}: gate ${rec.gate_failed ? 'failed twice' : rec.first_gate === 'pass' ? 'passed' : 'passed on retry'}, ${rec.attempts.length} attempt(s), list price USD ${cost.toFixed(2)}, quota ${Object.entries(rec.quota).map(([k, v]) => `${k} ${v}%`).join(' ') || 'unknown'}`);
        done++;
      }
      out(`${done} run(s) finished this time; review them with: node tools/experiment/${script} review "${dir}"`);
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

    if (command === 'check') {
      for (const state of pendingChecks(dir)) {
        const { hidden_check: h } = checkRun(dir, state, { baseEnv });
        out(`${state.run} ${state.task}: hidden tests ${h.result} (${h.passed} passed, ${h.failed} failed)`);
      }
      const all = committedRuns(dir).map((s) => s.hidden_check.result);
      out(`${all.length} run(s) checked: ${all.filter((r) => r === 'pass').length} pass their hidden tests, ${all.filter((r) => r !== 'pass').length} fail`);
      return 0;
    }

    if (command === 'agent-review') {
      const claude = findClaude(baseEnv, values.claude);
      const limit = values.limit === undefined ? Infinity : Number(values.limit);
      let done = 0;
      for (const state of pendingAgentReviews(dir)) {
        if (done >= limit) break;
        const allowed = quotaAllows(lastQuota(dir));
        if (!allowed.ok) {
          out(`stopped: ${allowed.over.join(', ')}. Run again after the window resets; finished reviews are kept.`);
          return 0;
        }
        const { agent_review: r } = agentReviewRun(dir, state, { baseEnv, claude, model: values.model, effort: values.effort, prove: !values['no-prove'] });
        const what = r.status === 'done' ? `${r.decision}, ${r.act_on} act_on (${r.proven} proven)` : `${r.status}: ${r.problem}`;
        out(`${state.run} ${state.task}: ${what}, ${Math.round(r.wall_ms / 1000)} s, list price USD ${r.cost_usd.toFixed(2)}`);
        done++;
      }
      const all = committedRuns(dir).filter((s) => s.agent_review?.sha === s.head_sha);
      const accepted = all.filter((s) => s.agent_review.decision === 'accept').length;
      out(`${all.length} of ${committedRuns(dir).length} run(s) reviewed: ${accepted} accepted, ${all.length - accepted} left for a person`);
      return 0;
    }

    if (command === 'exclude-time') {
      const [run] = positionals;
      if (!run || positionals.length > 1) throw new Error(`usage: ${script} exclude-time <dir> <run> --reason <text>`);
      excludeReviewTime(dir, run, values.reason);
      out(`${run}: review time left out of the analysis; its decision and checks still count`);
      return 0;
    }

    if (command === 'analyze') {
      const { rows, files } = writeAnalysis(dir);
      out(`${rows.length} finished run(s) analysed:\n  ${Object.values(files).join('\n  ')}`);
      return 0;
    }

    throw new Error(usage);
  };
}

/** Runs `main` as a script: its exit code, or the error on one line. */
export function runAsScript(main, name) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`${name}: ${err.message}`);
      process.exitCode = 2;
    },
  );
}
