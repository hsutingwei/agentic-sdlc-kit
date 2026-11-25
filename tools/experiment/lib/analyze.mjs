// E1 analysis: one row per finished run, joined from the experiment log and the
// kit's own report of that run, then compared by profile.
//
// Written to <experiment>/analysis/: runs.csv, profiles.csv and summary.md. They
// hold numbers, ids and names only; reviewer notes, prompts and code stay out, so
// the files can be published.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildReport, toCsv } from '../../../collector/lib/report.mjs';
import { aggregateScore } from '../../../collector/lib/score.mjs';
import { readEvents } from '../../../collector/lib/store.mjs';
import { readUsage } from '../../../collector/lib/usage.mjs';
import { loadTask } from './catalogue.mjs';
import { loadPlan, PROFILES, runDir, runStates } from './plan.mjs';

export const RUN_COLUMNS = [
  'run', 'task', 'type', 'risk_declared', 'risk_effective', 'profile', 'repeat', 'pilot',
  'first_gate', 'attempts', 'escalations', 'decision', 'review_minutes', 'review_time_excluded', 'merged', 'escaped_defects',
  'estimate_h', 'human_h', 'efficiency', 'data_quality', 'ai_h', 'agent_wall_s', 'list_cost_usd',
  'input_tokens', 'output_tokens', 'cache_write_tokens', 'cache_read_tokens', 'five_hour_pct_after', 'seven_day_pct_after',
];
export const PROFILE_COLUMNS = [
  'profile', 'runs', 'accepted', 'first_pass_rate', 'retries', 'escalations', 'escaped_defects',
  'reviews_timed', 'review_minutes_median', 'review_minutes_total', 'output_tokens_median', 'list_cost_usd_median', 'list_cost_usd_total',
  'ai_h_median', 'efficiency',
];

const round = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
export function median(values) {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
const sum = (values) => values.reduce((n, x) => n + (typeof x === 'number' ? x : 0), 0);

/** The kit's report row of the run's task, from the run's own metrics folder. */
function kitRow(dir, state, now) {
  const env = { AGENTIC_METRICS_HOME: path.join(runDir(dir, state.run), 'metrics') };
  const { events } = readEvents(env);
  const report = buildReport({ events, usageOf: (id) => readUsage(env, id), config: {}, now });
  return report.rows.find((r) => r.task_id === state.task) ?? null;
}

/** One row per finished run. */
export function runRows(dir, { now = new Date() } = {}) {
  const plan = loadPlan(dir);
  const states = runStates(dir);
  const rows = [];
  for (const planned of plan.runs) {
    const s = states.get(planned.run);
    if (s?.stage !== 'done') continue;
    const task = loadTask(planned.task);
    // A review time left out (excludeReviewTime) also leaves out the kit's human hours and efficiency.
    const excluded = Boolean(s.review_time_excluded);
    const k = kitRow(dir, s, now);
    const attempts = s.attempts ?? [];
    rows.push({
      run: planned.run,
      task: planned.task,
      type: task.brief.type,
      risk_declared: task.brief.risk,
      risk_effective: s.risk?.effective ?? null,
      profile: planned.profile,
      repeat: planned.repeat,
      pilot: planned.pilot,
      first_gate: s.first_gate,
      attempts: attempts.length,
      escalations: k?.escalations ?? (s.gate_failed ? 1 : 0),
      decision: s.decision,
      review_minutes: excluded ? null : s.review_minutes,
      review_time_excluded: excluded,
      merged: s.merged,
      escaped_defects: s.escaped_defects,
      estimate_h: task.brief.estimate_hours,
      human_h: excluded ? null : k?.human_h ?? null,
      efficiency: excluded ? null : k?.efficiency ?? null,
      data_quality: excluded ? 'Excluded' : k?.data_quality ?? null,
      ai_h: k?.ai_h ?? null,
      agent_wall_s: round(sum(attempts.map((a) => a.wall_ms)) / 1000, 1),
      list_cost_usd: round(sum(attempts.map((a) => a.result?.total_cost_usd)), 4),
      input_tokens: k?.input_tokens ?? null,
      output_tokens: k?.output_tokens ?? null,
      cache_write_tokens: k?.cache_write_tokens ?? null,
      cache_read_tokens: k?.cache_read_tokens ?? null,
      five_hour_pct_after: s.quota?.five_hour ?? null,
      seven_day_pct_after: s.quota?.seven_day ?? null,
      _kit: excluded ? null : k,
    });
  }
  return rows;
}

/** One row per profile. Repeats count like any other run. */
export function profileRows(rows) {
  return PROFILES.map((profile) => {
    const own = rows.filter((r) => r.profile === profile);
    const accepted = own.filter((r) => r.decision === 'accept');
    const score = aggregateScore(own.map((r) => r._kit).filter(Boolean));
    return {
      profile,
      runs: own.length,
      accepted: accepted.length,
      first_pass_rate: own.length ? round(own.filter((r) => r.first_gate === 'pass').length / own.length) : null,
      retries: own.filter((r) => r.attempts > 1).length,
      escalations: sum(own.map((r) => r.escalations)),
      escaped_defects: sum(accepted.map((r) => r.escaped_defects)),
      reviews_timed: own.filter((r) => typeof r.review_minutes === 'number').length,
      review_minutes_median: round(median(own.map((r) => r.review_minutes))),
      review_minutes_total: round(sum(own.map((r) => r.review_minutes))),
      output_tokens_median: median(own.map((r) => r.output_tokens)),
      list_cost_usd_median: round(median(own.map((r) => r.list_cost_usd)), 4),
      list_cost_usd_total: round(sum(own.map((r) => r.list_cost_usd)), 4),
      ai_h_median: round(median(own.map((r) => r.ai_h)), 3),
      efficiency: score.efficiency,
    };
  });
}

const cell = (v) => (v === null || v === undefined ? '' : String(v));

export function summaryMarkdown(plan, rows, profiles) {
  const lines = ['# E1 results', '', `Runs finished: ${rows.length} of ${plan.runs.length} planned (seed ${plan.seed}).`, ''];
  lines.push('## By profile', '');
  lines.push('| Profile | Runs | Accepted | First pass | Retries | Escalations | Escaped defects | Timed reviews | Review min (median) | Review min (total) | Output tokens (median) | List cost USD (median) | Efficiency |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of profiles) {
    lines.push(`| ${p.profile} | ${p.runs} | ${p.accepted} | ${cell(p.first_pass_rate)} | ${p.retries} | ${p.escalations} | ${p.escaped_defects} | ${p.reviews_timed} | ${cell(p.review_minutes_median)} | ${cell(p.review_minutes_total)} | ${cell(p.output_tokens_median)} | ${cell(p.list_cost_usd_median)} | ${cell(p.efficiency)} |`);
  }
  const untimed = rows.filter((r) => r.review_time_excluded).length;
  if (untimed) lines.push('', `Review time left out for ${untimed} run(s); their decisions and checks still count.`);
  lines.push('', '## By task (review minutes; ✓ accepted, ✗ rejected, ! escaped defect)', '');
  lines.push(`| Task | Risk | ${PROFILES.join(' | ')} |`, `|---|---|${PROFILES.map(() => '---').join('|')}|`);
  for (const task of [...new Set(rows.map((r) => r.task))].sort()) {
    const mine = rows.filter((r) => r.task === task);
    const mark = (r) => `${r.review_time_excluded ? 'untimed' : cell(r.review_minutes)} ${r.decision === 'accept' ? '✓' : '✗'}${r.escaped_defects ? '!' : ''}`;
    const cells = PROFILES.map((p) => mine.filter((r) => r.profile === p).map(mark).join(', ') || '–');
    lines.push(`| ${task} | ${mine[0].risk_effective ?? mine[0].risk_declared} | ${cells.join(' | ')} |`);
  }
  const repeated = [...new Set(rows.filter((r) => r.repeat > 1).map((r) => `${r.task}|${r.profile}`))];
  if (repeated.length) {
    lines.push('', '## Same task, same profile, several runs', '', '| Task | Profile | Runs | Review min | Output tokens | First pass |', '|---|---|---|---|---|---|');
    for (const key of repeated.sort()) {
      const [task, profile] = key.split('|');
      const rs = rows.filter((r) => r.task === task && r.profile === profile);
      lines.push(`| ${task} | ${profile} | ${rs.length} | ${rs.map((r) => cell(r.review_minutes)).join(', ')} | ${rs.map((r) => cell(r.output_tokens)).join(', ')} | ${rs.map((r) => r.first_gate).join(', ')} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function writeAnalysis(dir, { now = new Date() } = {}) {
  const plan = loadPlan(dir);
  const rows = runRows(dir, { now });
  const profiles = profileRows(rows);
  const out = path.join(dir, 'analysis');
  mkdirSync(out, { recursive: true });
  const files = { runs: path.join(out, 'runs.csv'), profiles: path.join(out, 'profiles.csv'), summary: path.join(out, 'summary.md') };
  writeFileSync(files.runs, toCsv(rows, RUN_COLUMNS));
  writeFileSync(files.profiles, toCsv(profiles, PROFILE_COLUMNS));
  writeFileSync(files.summary, summaryMarkdown(plan, rows, profiles));
  return { rows, profiles, files };
}
