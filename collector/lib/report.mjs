// Reports: tasks.csv, verifications.csv, usage.csv and summary.md.
//
// Every task row carries a data-quality grade and the reasons behind it.
// Numbers that cannot be measured are left empty and flagged, never estimated.
// See docs/metrics.md for each definition.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { usageError } from '../../core/errors.mjs';
import { ACTIVITIES, deriveHumanTime } from './human-time.mjs';
import { dataPath } from './paths.mjs';
import { deriveQuota } from './quota.mjs';
import { loadConfig } from './registry.mjs';
import { aggregateScore, scoreTask, scoringWeights } from './score.mjs';
import { readEvents } from './store.mjs';
import { deriveTasks } from './tasks.mjs';
import { hoursWithin, sessionIntervals, taskAiTime } from './turns.mjs';
import { readUsage } from './usage.mjs';

const TOKENS = ['input_tokens', 'output_tokens', 'cache_write_tokens', 'cache_read_tokens'];

export const COLUMNS = [
  'task_id',
  'project_id',
  'title',
  'type',
  'risk',
  'profile',
  'status',
  'outcome',
  'completed_by',
  'started_at',
  'ended_at',
  'lead_time_h',
  'ai_h',
  'human_h',
  ...ACTIVITIES.map((a) => `human_${a}_h`),
  'waiting_human_h',
  'blocked_h',
  'estimate_h',
  'efficiency_raw',
  'quality',
  'efficiency',
  'verifications',
  'first_pass',
  'escalations',
  'escaped_defects',
  'gate_runs',
  'sessions',
  'subagents',
  ...TOKENS,
  'data_quality',
  'flags',
];

export const VERIFICATION_COLUMNS = ['task_id', 'ts', 'check', 'result', 'executor', 'gate', 'sha', 'evidence'];
export const USAGE_COLUMNS = ['task_id', 'model', 'responses', ...TOKENS];
export const OUTSIDE_TASKS = '(outside tasks)';

/** Flags that make a score impossible: the row is Missing. Every other flag makes it Partial. */
export const MISSING_FLAGS = new Set(['no_task_start', 'open_task', 'deferred', 'no_estimate', 'no_human_time', 'open_human_timer']);

export const FLAG_HELP = {
  open_task: 'the task has not ended, so lead time, outcome and score are unknown',
  deferred: 'the task was deferred: it is neither done nor dropped, so it is not scored',
  no_estimate: 'no estimate without AI was recorded at start; efficiency cannot be computed',
  no_human_time: 'no human time was recorded (asdk human start/stop/adjust); efficiency cannot be computed',
  open_human_timer: 'a human timer is still running on the task; its time is not counted yet',
  no_task_start: 'events reference this task but it was never started',
  no_verification: 'no check was recorded, so the first-pass rate is unknown',
  no_ai_activity: 'no AI turn was recorded for a task said to be done with AI (hooks off, or work outside the task worktree)',
  unpaired_turns: 'a turn or sub-agent has no recorded end; it was counted up to the session’s last event',
  concurrent_sessions: 'more than one session worked on the task at the same moment',
  usage_not_harvested: 'token usage of a session is missing (no transcript, or asdk harvest not run)',
  usage_unreadable_records: 'some transcript records could not be read; token counts are partial',
  long_human_session: 'a timed period was longer than eight hours; check that the timer was not left running',
  human_timer_auto_stopped: 'a timer was still running when the task ended and was stopped then',
  unpaired_human_stop: 'a timer stop had no matching start',
  overlapping_human_timer: 'a timer started while another was running',
  clock_went_back: 'the clock went back between a timer start and stop; that period counts as zero',
  duplicate_task_start: 'the task was started more than once; the first start is used',
  duplicate_task_end: 'the task was ended more than once; the first end is used',
  unexpected_block: 'a block was recorded for a task that was not active',
  unexpected_resume: 'a resume was recorded for a task that was not blocked',
};

const round2 = (n) => Math.round(n * 100) / 100;
const hoursBetween = (from, to) => round2((Date.parse(to) - Date.parse(from)) / 3_600_000);
const emptyTokens = () => Object.fromEntries([['responses', 0], ...TOKENS.map((k) => [k, 0])]);

/** Text fragments from config.json `privacy.mask`, replaced in every report cell and line. */
export function privacyMasks(config = {}) {
  const list = config.privacy?.mask ?? [];
  if (!Array.isArray(list) || list.some((s) => typeof s !== 'string' || s.trim() === '' || s.length > 200)) {
    throw usageError('config.json: "privacy.mask" must be a list of non-empty strings');
  }
  return list;
}

export function maskText(text, masks) {
  let out = text;
  for (const m of masks) out = out.replace(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'), '[masked]');
  return out;
}

/**
 * Builds every report table from events and harvested usage.
 * @param {{ events: object[], usageOf: (sessionId: string) => object|null, config?: object, now?: Date }} input
 */
export function buildReport({ events, usageOf, config = {}, now = new Date() }) {
  const weights = scoringWeights(config);
  const { tasks, orphans } = deriveTasks(events);
  const human = deriveHumanTime(events);
  const intervals = sessionIntervals(events);
  const nowMs = now.getTime();

  const fixedBy = new Map();
  for (const t of tasks.values()) for (const id of t.fixes) fixedBy.set(id, (fixedBy.get(id) ?? 0) + 1);

  const rows = [];
  const verifications = [];
  const usageByTask = new Map();
  const attributed = new Set(); // session:response ids counted for some task

  for (const t of tasks.values()) {
    const flags = new Set(t.flags);
    if (t.status !== 'ended') flags.add('open_task');
    if (t.outcome === 'deferred') flags.add('deferred');
    if (t.estimate_hours === undefined) flags.add('no_estimate');
    if (t.verifications.length === 0) flags.add('no_verification');

    const h = human.tasks.get(t.task_id);
    for (const f of h?.flags ?? []) flags.add(f);
    if (!h || (h.periods.length === 0 && h.adjustments.length === 0)) flags.add('no_human_time');
    if (human.open?.task_id === t.task_id) flags.add('open_human_timer');

    const ai = taskAiTime(intervals, t, nowMs);
    if (ai.unpaired > 0) flags.add('unpaired_turns');
    if (ai.concurrent) flags.add('concurrent_sessions');
    if (ai.ai_ms === 0 && t.status === 'ended' && t.completed_by !== 'human' && ['accepted', 'rejected'].includes(t.outcome)) flags.add('no_ai_activity');

    // Tokens of the task's sessions, inside the task window.
    const from = Date.parse(t.started_at);
    const to = t.ended_at ? Date.parse(t.ended_at) : nowMs;
    const tokens = emptyTokens();
    const byModel = new Map();
    for (const session of t.sessions) {
      const doc = usageOf(session);
      if (!doc || doc.invalid) {
        flags.add('usage_not_harvested');
        continue;
      }
      if (doc.sources.some((s) => s.unparsed + s.bad_lines > 0)) flags.add('usage_unreadable_records');
      for (const m of doc.messages) {
        const at = Date.parse(m.ts);
        if (at < from || at > to) continue;
        attributed.add(`${session}:${m.id}`);
        const per = byModel.get(m.model) ?? emptyTokens();
        for (const acc of [tokens, per]) {
          acc.responses++;
          for (const k of TOKENS) acc[k] += m[k];
        }
        byModel.set(m.model, per);
      }
    }
    usageByTask.set(t.task_id, byModel);

    for (const v of t.verifications) verifications.push({ task_id: t.task_id, ts: v.ts, check: v.check, result: v.result, executor: v.executor, gate: v.gate ?? null, sha: v.sha ?? null, evidence: v.evidence ?? null });

    const row = {
      task_id: t.task_id,
      project_id: t.project_id,
      title: t.title ?? null,
      type: t.type,
      risk: t.risk,
      profile: t.profile ?? null,
      status: t.status,
      outcome: t.outcome ?? null,
      completed_by: t.completed_by ?? null,
      started_at: t.started_at,
      ended_at: t.ended_at ?? null,
      lead_time_h: t.ended_at ? hoursBetween(t.started_at, t.ended_at) : null,
      ai_h: ai.ai_h,
      human_h: h ? round2(h.minutes / 60) : null,
      ...Object.fromEntries(ACTIVITIES.map((a) => [`human_${a}_h`, h ? round2((h.by_activity[a] ?? 0) / 60) : null])),
      waiting_human_h: hoursWithin(t.blocks.filter((b) => b.waiting_on === 'human'), t, nowMs),
      blocked_h: hoursWithin(t.blocks, t, nowMs),
      estimate_h: t.estimate_hours ?? null,
      verifications: t.verifications.length,
      first_pass: t.verifications.length ? t.verifications[0].result === 'pass' : null,
      escalations: t.escalations.length,
      escaped_defects: fixedBy.get(t.task_id) ?? 0,
      gate_runs: t.gate_runs.length,
      sessions: t.sessions.size,
      subagents: t.agents.size,
      ...Object.fromEntries(TOKENS.map((k) => [k, tokens[k]])),
    };
    Object.assign(row, scoreTask(row, weights));
    const sorted = [...flags].sort();
    row.data_quality = sorted.some((f) => MISSING_FLAGS.has(f)) ? 'Missing' : sorted.length ? 'Partial' : 'Complete';
    row.flags = sorted;
    rows.push(row);
  }

  for (const id of [...new Set(orphans.map((e) => e.task_id))].filter((x) => !tasks.has(x))) {
    const row = Object.fromEntries(COLUMNS.map((c) => [c, null]));
    rows.push({ ...row, task_id: id, verifications: 0, escalations: 0, escaped_defects: 0, gate_runs: 0, sessions: 0, subagents: 0, data_quality: 'Missing', flags: ['no_task_start'] });
  }
  rows.sort((a, b) => (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0));
  verifications.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  // Coverage: output tokens of every harvested session, inside and outside tasks.
  const allSessions = new Set(events.filter((e) => e.source === 'hook' && e.session_id).map((e) => e.session_id));
  const outside = new Map();
  let total = 0;
  let inTasks = 0;
  const notHarvested = [];
  for (const session of [...allSessions].sort()) {
    const doc = usageOf(session);
    if (!doc || doc.invalid) {
      notHarvested.push(session);
      continue;
    }
    for (const m of doc.messages) {
      total += m.output_tokens;
      if (attributed.has(`${session}:${m.id}`)) {
        inTasks += m.output_tokens;
        continue;
      }
      const per = outside.get(m.model) ?? emptyTokens();
      per.responses++;
      for (const k of TOKENS) per[k] += m[k];
      outside.set(m.model, per);
    }
  }

  const usageRows = [];
  for (const [taskId, byModel] of [...usageByTask].sort()) {
    for (const [model, t] of [...byModel].sort()) usageRows.push({ task_id: taskId, model, ...t });
  }
  for (const [model, t] of [...outside].sort()) usageRows.push({ task_id: OUTSIDE_TASKS, model, ...t });

  return {
    rows,
    verifications,
    usageRows,
    coverage: { sessions: allSessions.size, not_harvested: notHarvested.length, output_tokens: total, in_tasks: inTasks, share_in_tasks: total > 0 ? round2(inTasks / total) : null },
    aggregate: aggregateScore(rows),
    quota: deriveQuota(events),
    weights,
  };
}

const csvCell = (v, masks) => {
  if (v === null || v === undefined) return '';
  const s = maskText(Array.isArray(v) ? v.join(';') : String(v), masks);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a UTF-8 BOM so spreadsheet tools read CJK text correctly. */
export function toCsv(rows, columns = COLUMNS, masks = []) {
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c], masks)).join(','))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const md = (v) => (v === null || v === undefined || v === '' ? '–' : String(v).replace(/\|/g, '\\|'));
const fmt = (n) => (n === null || n === undefined ? '–' : n.toLocaleString('en-US'));

export function toMarkdown(report, { generatedAt, invalidLines = 0, masks = [] }) {
  const { rows, aggregate, coverage, quota, usageRows } = report;
  const grade = (g) => rows.filter((r) => r.data_quality === g).length;
  const out = ['# Task scorecard', '', `Generated ${generatedAt}. ${rows.length} task(s): ${grade('Complete')} Complete, ${grade('Partial')} Partial, ${grade('Missing')} Missing.`, ''];

  out.push('## Efficiency', '');
  if (aggregate.efficiency === null) out.push('Not enough data yet: no task is `Complete` with human time recorded.');
  else {
    out.push(
      `**${aggregate.efficiency}×** over ${aggregate.tasks} Complete task(s): ${aggregate.estimate_h} h of quality-weighted estimated work ` +
        `(${aggregate.accepted} accepted) for ${aggregate.human_h} human hours. Rejected and abandoned tasks count their hours and earn nothing.`,
    );
  }
  out.push('', 'Efficiency = estimate without AI ÷ human hours, times a quality factor (see docs/metrics.md).', '');

  out.push('## Tasks', '');
  out.push('| Task | Project | Outcome | Lead (h) | AI (h) | Human (h) | Waiting on human (h) | Estimate (h) | Efficiency | Checks | First pass | Escalations | Output tokens | Data quality |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const eff = r.efficiency === null || r.efficiency === undefined ? null : r.quality === 1 || r.outcome !== 'accepted' ? `${r.efficiency}` : `${r.efficiency_raw} × ${r.quality} = ${r.efficiency}`;
    out.push(
      `| ${md(r.task_id)} | ${md(r.project_id)} | ${md(r.outcome ?? r.status)} | ${md(r.lead_time_h)} | ${md(r.ai_h)} | ${md(r.human_h)} | ${md(r.waiting_human_h || null)} | ` +
        `${md(r.estimate_h)} | ${md(eff)} | ${r.verifications} | ${md(r.first_pass === null ? null : r.first_pass ? 'yes' : 'no')} | ${r.escalations} | ${fmt(r.output_tokens)} | ${r.data_quality} |`,
    );
  }

  out.push('', '## Where human time went', '');
  const totals = Object.fromEntries(ACTIVITIES.map((a) => [a, round2(rows.reduce((n, r) => n + (r[`human_${a}_h`] ?? 0), 0))]));
  const all = round2(Object.values(totals).reduce((n, v) => n + v, 0));
  out.push(all > 0 ? ACTIVITIES.map((a) => `${a} ${totals[a]} h`).join(' · ') + ` (total ${all} h)` : 'No human time recorded.');

  out.push('', '## Tokens', '');
  const byModel = new Map();
  for (const u of usageRows) {
    const t = byModel.get(u.model) ?? { responses: 0, output_tokens: 0 };
    t.responses += u.responses;
    t.output_tokens += u.output_tokens;
    byModel.set(u.model, t);
  }
  if (byModel.size === 0) out.push('No harvested usage (asdk harvest --all, or asdk report --harvest).');
  for (const [model, t] of [...byModel].sort()) out.push(`- ${model}: ${fmt(t.responses)} responses, ${fmt(t.output_tokens)} output tokens`);
  out.push(
    '',
    coverage.share_in_tasks === null
      ? `Task coverage: unknown (${coverage.sessions} session(s), none harvested).`
      : `Task coverage: ${Math.round(coverage.share_in_tasks * 100)}% of ${fmt(coverage.output_tokens)} output tokens were spent inside tasks` +
          `${coverage.not_harvested ? `; ${coverage.not_harvested} of ${coverage.sessions} session(s) not harvested` : ''}.`,
  );

  out.push('', '## Quota', '');
  const plan = quota.plan ? `${quota.plan.plan} (from ${quota.plan.effective_at})` : quota.snapshot_plan ? `${quota.snapshot_plan.plan} (seen in a snapshot)` : 'unknown';
  out.push(`Plan: ${plan}.`);
  const windows = Object.entries(quota.windows).sort();
  if (windows.length === 0) out.push('No quota snapshot recorded.');
  for (const [name, w] of windows) out.push(`- ${name}: ${w.used_pct}% at ${w.recorded_at}${w.resets_at ? `, resets ${w.resets_at}` : ''}`);

  const used = [...new Set(rows.flatMap((r) => r.flags))].sort();
  out.push('', '## Data quality', '');
  out.push('`Complete`: every input was recorded. `Partial`: a score is shown but something is doubtful. `Missing`: no score is possible. Only Complete tasks count in the efficiency above.', '');
  for (const f of used) out.push(`- \`${f}\`: ${FLAG_HELP[f] ?? 'see docs/metrics.md'} (${rows.filter((r) => r.flags.includes(f)).map((r) => r.task_id).join(', ')})`);
  if (used.length === 0) out.push('- no flags');
  if (invalidLines > 0) out.push('', `${invalidLines} event line(s) could not be read and were left out.`);
  out.push('', 'Empty cells were not measured; they are never filled with estimates. Limits are listed in docs/metrics.md.', '');
  return maskText(out.join('\n'), masks);
}

/** Builds the report from the metrics directory and writes the four files. */
export function writeReports(env, { now = new Date(), outDir = dataPath(env, 'reports'), config = loadConfig(env) } = {}) {
  const masks = privacyMasks(config);
  const { events, invalid } = readEvents(env);
  const report = buildReport({ events, usageOf: (id) => readUsage(env, id), config, now });
  mkdirSync(outDir, { recursive: true });
  const files = {
    tasks: path.join(outDir, 'tasks.csv'),
    verifications: path.join(outDir, 'verifications.csv'),
    usage: path.join(outDir, 'usage.csv'),
    summary: path.join(outDir, 'summary.md'),
  };
  writeFileSync(files.tasks, toCsv(report.rows, COLUMNS, masks));
  writeFileSync(files.verifications, toCsv(report.verifications, VERIFICATION_COLUMNS, masks));
  writeFileSync(files.usage, toCsv(report.usageRows, USAGE_COLUMNS, masks));
  writeFileSync(files.summary, toMarkdown(report, { generatedAt: now.toISOString(), invalidLines: invalid, masks }));
  return { ...report, files, invalid };
}
