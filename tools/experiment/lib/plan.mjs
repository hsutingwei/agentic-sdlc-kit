// An experiment's run plan and its log.
//
// An experiment lives in its own folder, never in ~/.agentic-metrics:
//
//   plan.json         which task runs with which profile, in which order (seeded),
//                     and the suite the tasks come from
//   runs.jsonl        what happened, appended one line at a time; state is derived
//   bin/              an `asdk` command for the agent (the verify skill calls it)
//   runs/<run>/       one demo repository, worktree root and metrics folder per run
//   analysis/         CSV files and tables made from the log and the reports
//
// The plan starts with a pilot (one task with every profile), so the cost of a run
// is known before the rest is started.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const PROFILES = ['ultra', 'max', 'pro'];
// Each profile is reached through the plan name it belongs to, as a user would record it.
export const PLAN_OF = { ultra: 'ultra', max: 'max', pro: 'pro' };

/** mulberry32: a small seeded generator, so the order can be reproduced. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Every task with every profile once, plus extra runs to see how much one setting
 * varies; the pilot task's runs come first, everything else in seeded order.
 * @returns {{ seed: number, pilot: string, runs: Array<{ run: string, task: string, profile: string, repeat: number, pilot: boolean }> }}
 */
export function buildPlan({ tasks, seed, pilot, repeats = [] }) {
  if (!tasks.includes(pilot)) throw new Error(`pilot task ${pilot} is not in the catalogue`);
  const rand = seeded(seed);
  const all = tasks.flatMap((task) => PROFILES.map((profile) => ({ task, profile, repeat: 1 })));
  for (const { task, profile, count } of repeats) {
    for (let r = 2; r <= count + 1; r++) all.push({ task, profile, repeat: r });
  }
  const first = shuffle(all.filter((r) => r.task === pilot && r.repeat === 1), rand);
  const rest = shuffle(all.filter((r) => !(r.task === pilot && r.repeat === 1)), rand);
  const runs = [...first, ...rest].map((r, i) => ({ run: `r${String(i + 1).padStart(2, '0')}`, ...r, pilot: i < first.length }));
  return { seed, pilot, runs };
}

export const planFile = (dir) => path.join(dir, 'plan.json');
export const logFile = (dir) => path.join(dir, 'runs.jsonl');
export const runDir = (dir, run) => path.join(dir, 'runs', run);

export function savePlan(dir, plan) {
  if (existsSync(planFile(dir))) throw new Error(`${planFile(dir)} exists; an experiment's plan is never replaced`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(planFile(dir), `${JSON.stringify({ schema_version: 1, created_at: new Date().toISOString(), ...plan }, null, 2)}\n`);
}

export function loadPlan(dir) {
  if (!existsSync(planFile(dir))) throw new Error(`no experiment in ${dir}; run "init" first`);
  return JSON.parse(readFileSync(planFile(dir), 'utf8'));
}

/** Appends one record to the log. */
export function logRun(dir, record, now = new Date()) {
  appendFileSync(logFile(dir), `${JSON.stringify({ ts: now.toISOString(), ...record })}\n`);
}

export function readLog(dir) {
  if (!existsSync(logFile(dir))) return [];
  return readFileSync(logFile(dir), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// Stages a run goes through. A run is finished when it reaches `done` or `failed`.
export const STAGES = ['started', 'agent', 'gate', 'review', 'done', 'failed'];

/** The latest record of each run, merged: { run -> { stage, ...fields } }. */
export function runStates(dir) {
  const states = new Map();
  for (const r of readLog(dir)) states.set(r.run, { ...(states.get(r.run) ?? {}), ...r });
  return states;
}
