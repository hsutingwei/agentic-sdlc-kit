// Scorecard report: one row per task, every row with a data-quality grade and
// the reasons behind it. Numbers that cannot be measured yet are left empty and
// flagged, never estimated.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataPath } from './paths.mjs';
import { readEvents } from './store.mjs';
import { deriveTasks } from './tasks.mjs';

export const COLUMNS = [
  'task_id',
  'project_id',
  'title',
  'type',
  'risk',
  'status',
  'outcome',
  'completed_by',
  'started_at',
  'ended_at',
  'lead_time_h',
  'estimate_h',
  'human_h',
  'efficiency',
  'verifications',
  'first_pass',
  'gate_runs',
  'sessions',
  'subagents',
  'data_quality',
  'flags',
];

export const FLAG_HELP = {
  open_task: 'the task has not ended, so lead time and outcome are unknown',
  no_estimate: 'no estimate without AI was recorded at start; efficiency cannot be computed',
  no_verification: 'no check was recorded for the task',
  no_human_time: 'human time is not recorded yet (task human start/stop arrives in a later phase)',
  duplicate_task_start: 'the task was started more than once; the first start is used',
  duplicate_task_end: 'the task was ended more than once; the first end is used',
  no_task_start: 'events reference this task but it was never started',
};

const hours = (from, to) => Math.round(((Date.parse(to) - Date.parse(from)) / 3_600_000) * 100) / 100;

export function buildRows(events) {
  const { tasks, orphans } = deriveTasks(events);
  const rows = [];
  for (const t of tasks.values()) {
    const flags = new Set(t.flags);
    if (t.status !== 'ended') flags.add('open_task');
    if (t.estimate_hours === undefined) flags.add('no_estimate');
    if (t.verifications.length === 0) flags.add('no_verification');
    flags.add('no_human_time');
    rows.push({
      task_id: t.task_id,
      project_id: t.project_id,
      title: t.title ?? null,
      type: t.type,
      risk: t.risk,
      status: t.status,
      outcome: t.outcome ?? null,
      completed_by: t.completed_by ?? null,
      started_at: t.started_at,
      ended_at: t.ended_at ?? null,
      lead_time_h: t.ended_at ? hours(t.started_at, t.ended_at) : null,
      estimate_h: t.estimate_hours ?? null,
      human_h: null,
      efficiency: null,
      verifications: t.verifications.length,
      first_pass: t.verifications.length ? t.verifications[0].result === 'pass' : null,
      gate_runs: t.gate_runs.length,
      sessions: t.sessions.size,
      subagents: t.agents.size,
      data_quality: flags.size === 0 ? 'Complete' : 'Partial',
      flags: [...flags].sort(),
    });
  }
  const orphanIds = [...new Set(orphans.map((e) => e.task_id))].filter((id) => !tasks.has(id));
  for (const id of orphanIds) {
    const row = Object.fromEntries(COLUMNS.map((c) => [c, null]));
    rows.push({ ...row, task_id: id, verifications: 0, gate_runs: 0, sessions: 0, subagents: 0, data_quality: 'Missing', flags: ['no_task_start'] });
  }
  return rows.sort((a, b) => (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0));
}

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join(';') : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a UTF-8 BOM so spreadsheet tools read CJK text correctly. */
export function toCsv(rows) {
  const lines = [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

const md = (v) => (v === null || v === undefined || v === '' ? '–' : String(v).replace(/\|/g, '\\|'));

export function toMarkdown(rows, { generatedAt, invalidLines }) {
  const out = ['# Task scorecard', '', `Generated ${generatedAt}. ${rows.length} task(s).`, ''];
  out.push('| Task | Project | Outcome | Lead time (h) | Estimate (h) | Human (h) | Efficiency | Checks | First pass | Data quality |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    out.push(
      `| ${md(r.task_id)} | ${md(r.project_id)} | ${md(r.outcome ?? r.status)} | ${md(r.lead_time_h)} | ${md(r.estimate_h)} | ${md(r.human_h)} | ${md(r.efficiency)} | ` +
        `${r.verifications} | ${md(r.first_pass === null ? null : r.first_pass ? 'yes' : 'no')} | ${r.data_quality} |`,
    );
  }
  const used = [...new Set(rows.flatMap((r) => r.flags))].sort();
  out.push('', '## Data quality', '');
  out.push('A row is `Complete` only when every input of its numbers was recorded; otherwise it is `Partial` (or `Missing` when the task was never started) and lists why:', '');
  for (const f of used) out.push(`- \`${f}\`: ${FLAG_HELP[f] ?? 'see docs'} (${rows.filter((r) => r.flags.includes(f)).map((r) => r.task_id).join(', ')})`);
  if (used.length === 0) out.push('- no flags');
  if (invalidLines > 0) out.push('', `${invalidLines} event line(s) could not be read and were left out.`);
  out.push('', 'Empty cells were not measured; they are never filled with estimates.', '');
  return out.join('\n');
}

export function writeReports(env, { now = new Date() } = {}) {
  const { events, invalid } = readEvents(env);
  const rows = buildRows(events);
  const dir = dataPath(env, 'reports');
  mkdirSync(dir, { recursive: true });
  const files = { csv: path.join(dir, 'tasks.csv'), summary: path.join(dir, 'summary.md') };
  writeFileSync(files.csv, toCsv(rows));
  writeFileSync(files.summary, toMarkdown(rows, { generatedAt: now.toISOString(), invalidLines: invalid }));
  return { rows, files, invalid };
}
