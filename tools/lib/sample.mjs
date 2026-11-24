// Fictional sample data for examples/sample-report/: two weeks of work on the
// demo projects, written as real events and usage files, then turned into the four
// reports by the real report code. Everything is invented: projects demo-api and
// demo-web, tasks DEMO-001…, the person "Demo Dev", the numbers. A fixed seed and
// fixed dates make the output identical on every run.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { dataPath } from '../../collector/lib/paths.mjs';
import { writeReports } from '../../collector/lib/report.mjs';
import { appendEvent, makeEvent } from '../../collector/lib/store.mjs';

export const SAMPLE_NOW = new Date('2026-11-14T09:00:00.000Z');

/** Small deterministic PRNG (mulberry32). */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODELS = { strong: 'claude-opus-5-5', standard: 'claude-sonnet-5-5', light: 'claude-haiku-5-5' };

// One entry per task. Times are minutes after 09:00 UTC on the given day of November 2026.
// human: [activity, minutes]; checks: results of script checks in order; ai: turns of [start, length] minutes.
const TASKS = [
  { id: 'DEMO-001', project: 'demo-api', type: 'feature', risk: 'low', title: 'Due dates on todo items', estimate: 6, day: 2, length: 240, human: [['spec', 20], ['review', 25], ['acceptance', 10]], checks: ['fail', 'pass'], ai: [[25, 70]], agents: 1, outcome: 'accepted', by: 'ai' },
  { id: 'DEMO-002', project: 'demo-api', type: 'bugfix', risk: 'low', title: 'Reject empty titles', estimate: 2, day: 3, length: 120, human: [['spec', 10], ['review', 10], ['acceptance', 5]], checks: ['pass'], ai: [[15, 25]], agents: 1, outcome: 'accepted', by: 'ai' },
  { id: 'DEMO-003', project: 'demo-web', type: 'feature', risk: 'medium', title: 'Overdue badge in the list view', estimate: 8, day: 3, length: 360, human: [['spec', 30], ['review', 40], ['fix', 30], ['acceptance', 15]], checks: ['fail', 'fail', 'pass'], ai: [[35, 90], [200, 40]], agents: 2, escalate: [['repeated_failure', 'unit tests failed twice']], outcome: 'accepted', by: 'ai_with_human_fixes' },
  { id: 'DEMO-004', project: 'demo-api', type: 'refactor', risk: 'low', title: 'Split the request router', estimate: 4, day: 4, length: 180, human: [['spec', 15], ['review', 20], ['acceptance', 5]], checks: ['pass'], ai: [[20, 60]], agents: 1, outcome: 'accepted', by: 'ai' },
  { id: 'DEMO-005', project: 'demo-web', type: 'test', risk: 'low', title: 'Tests for the todo form', estimate: 3, day: 5, length: 150, human: [['spec', 10], ['review', 15]], checks: ['pass'], ai: [[15, 45]], agents: 1, outcome: 'accepted', by: 'ai' },
  { id: 'DEMO-006', project: 'demo-api', type: 'feature', risk: 'high', title: 'Bulk import from CSV', estimate: 12, day: 6, length: 600, human: [['spec', 45], ['review', 60], ['fix', 45], ['acceptance', 20]], checks: ['fail', 'pass'], ai: [[50, 120], [300, 60]], agents: 3, block: [240, 300, 'waiting for a decision on duplicate rows', 'human'], escalate: [['risk_decision', 'how to treat duplicate rows']], outcome: 'accepted', by: 'ai_with_human_fixes' },
  { id: 'DEMO-007', project: 'demo-web', type: 'investigation', risk: 'medium', title: 'Why the list renders twice', estimate: 3, day: 9, length: 200, human: [['spec', 15], ['review', 50]], checks: ['pass'], ai: [[20, 80]], agents: 2, outcome: 'rejected', by: 'ai' },
  { id: 'DEMO-008', project: 'demo-api', type: 'bugfix', risk: 'low', title: 'Due date lost on update', estimate: 1.5, day: 9, length: 90, human: [['spec', 5], ['review', 10], ['acceptance', 5]], checks: ['pass'], ai: [[10, 20]], agents: 1, fixes: 'DEMO-001', outcome: 'accepted', by: 'ai' },
  { id: 'DEMO-009', project: 'demo-web', type: 'docs', risk: 'low', title: 'Usage section in the README', estimate: 1, day: 10, length: 60, human: [['spec', 5], ['review', 10]], checks: ['pass'], ai: [[8, 15]], agents: 0, outcome: 'accepted', by: 'ai', noUsage: true },
  { id: 'DEMO-010', project: 'demo-api', type: 'config', risk: 'medium', title: 'Stricter lint settings', estimate: 2, day: 10, length: 120, human: [['spec', 10], ['review', 20]], checks: ['fail', 'fail'], ai: [[15, 40]], agents: 1, escalate: [['takeover', 'lint rules conflicted; finished by hand']], outcome: 'abandoned', by: undefined },
  { id: 'DEMO-011', project: 'demo-web', type: 'feature', risk: 'medium', title: 'Keyboard shortcuts', estimate: 5, day: 12, length: 120, human: [['spec', 20]], checks: [], ai: [[25, 50]], agents: 1, outcome: 'deferred', by: undefined },
  { id: 'DEMO-012', project: 'demo-api', type: 'feature', risk: 'low', title: 'Search by text', estimate: 4, day: 13, length: null, human: [['spec', 15]], checks: [], ai: [[20, 40]], agents: 1, outcome: null },
];

/** Writes the fictional history into the metrics directory of `env`. */
export function writeSampleData(env) {
  const rnd = random(20261102);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const at = (day, minutes) => new Date(Date.UTC(2026, 10, day, 9, 0) + minutes * 60000);

  mkdirSync(dataPath(env), { recursive: true });
  writeFileSync(
    dataPath(env, 'config.json'),
    `${JSON.stringify({ schema_version: 1, projects: [{ id: 'demo-api', root: '/home/dev/demo-api' }, { id: 'demo-web', root: '/home/dev/demo-web' }] }, null, 2)}\n`,
  );

  appendEvent(env, makeEvent({ source: 'cli', event: 'quota.plan-change', data: { plan: 'max-5x', effective_at: at(1, 0).toISOString() } }, at(1, 0)));

  let messageNo = 0;
  const usageDocs = new Map();
  const respond = (session, when, model, agentId) => {
    messageNo++;
    const doc = usageDocs.get(session);
    const output = model === MODELS.strong ? int(300, 2500) : model === MODELS.standard ? int(400, 3000) : int(100, 800);
    doc.messages.push({
      id: createHash('sha256').update(`sample-${messageNo}`).digest('hex').slice(0, 20),
      ts: when.toISOString(),
      model,
      ...(model === MODELS.strong ? { effort: 'high' } : {}),
      ...(agentId ? { agent_id: agentId } : {}),
      input_tokens: int(5, 60),
      output_tokens: output,
      cache_write_tokens: int(500, 6000),
      cache_read_tokens: int(8000, 90000),
    });
  };

  for (const task of TASKS) {
    const cli = (minutes, event, data) => appendEvent(env, makeEvent({ source: 'cli', event, project_id: task.project, task_id: task.id, data }, at(task.day, minutes)));
    cli(0, 'task.start', { type: task.type, risk: task.risk, title: task.title, estimate_hours: task.estimate, fixes: task.fixes, profile: 'max', profile_source: 'manual' });

    // Human work, laid out around the AI turns.
    let clock = 1;
    for (const [activity, minutes] of task.human) {
      if (activity === 'review') clock = Math.max(clock, task.ai.at(-1)[0] + task.ai.at(-1)[1] + 5);
      cli(clock, 'human.start', { activity });
      cli(clock + minutes, 'human.stop', undefined);
      clock += minutes + 2;
    }

    // AI turns and sub-agents in one session tied to the task.
    const session = `sample-${task.id.toLowerCase()}`;
    usageDocs.set(session, { schema_version: 1, tool: 'claude-code', session_id: session, tool_versions: ['2.1.330'], sources: [{ kind: 'main', lines: 0, bad_lines: 0, unparsed: 0 }], messages: [], tool_results: { count: 0, bytes: 0 } });
    const hook = (minutes, event, agent) => appendEvent(env, makeEvent({ source: 'hook', event, tool: 'claude-code', session_id: session, project_id: task.project, task_id: task.id, agent }, at(task.day, minutes)), session);
    hook(task.ai[0][0] - 1, 'SessionStart');
    task.ai.forEach(([start, length], i) => {
      hook(start, 'UserPromptSubmit');
      respond(session, at(task.day, start + 1), MODELS.strong);
      for (let a = 0; a < (i === 0 ? task.agents : 0); a++) {
        const agent = { id: `a${task.id.slice(-3)}${a}`, type: a === 0 ? 'implementer' : a === 1 ? 'tester' : 'reviewer' };
        const from = start + 2 + a * 3;
        hook(from, 'SubagentStart', agent);
        const model = agent.type === 'implementer' ? MODELS.standard : MODELS.light;
        for (let k = 0; k < 3; k++) respond(session, at(task.day, from + 2 + k * 5), model, agent.id);
        hook(Math.min(from + length - 5, start + length - 1), 'SubagentStop', agent);
        const doc = usageDocs.get(session);
        doc.sources.push({ kind: 'subagent', agent_id: agent.id, agent_type: agent.type, model, lines: int(40, 300), bad_lines: 0, unparsed: 0 });
      }
      respond(session, at(task.day, start + length - 1), MODELS.strong);
      hook(start + length, 'Stop');
    });
    const doc = usageDocs.get(session);
    doc.sources[0].lines = int(100, 900);
    doc.tool_results = { count: int(10, 80), bytes: int(20000, 400000) };

    // Checks: script checks from the gate, then the human acceptance.
    let checkAt = task.ai[0][0] + task.ai[0][1] + 2;
    for (const result of task.checks) {
      appendEvent(env, makeEvent({ source: 'gate', event: 'gate.run', project_id: task.project, task_id: task.id, data: { gate: 'G1', result, head_sha: createHash('sha1').update(`${task.id}${checkAt}`).digest('hex'), tree_clean: true, runner: 'local' } }, at(task.day, checkAt)));
      cli(checkAt, 'task.verify', { check: 'unit', result, executor: 'script', gate: 'G1' });
      checkAt += 15;
    }
    if (task.block) {
      const [from, to, reason, waitingOn] = task.block;
      cli(from, 'task.block', { reason, waiting_on: waitingOn });
      cli(to, 'task.resume', { reason: 'decided' });
    }
    for (const [kind, reason] of task.escalate ?? []) cli(checkAt, 'task.escalate', { kind, reason });
    if (task.outcome === 'accepted') cli(task.length - 3, 'task.verify', { check: 'acceptance', result: 'pass', executor: 'human' });
    if (task.length !== null) cli(task.length, 'task.end', { outcome: task.outcome, completed_by: task.by });
    if (!task.noUsage) usageDocs.get(session).messages.sort((a, b) => (a.ts < b.ts ? -1 : 1));
    if (task.noUsage) usageDocs.delete(session);
  }

  // AI use outside any task: a session in an unregistered folder.
  const loose = 'sample-outside-tasks';
  usageDocs.set(loose, { schema_version: 1, tool: 'claude-code', session_id: loose, tool_versions: ['2.1.330'], sources: [{ kind: 'main', lines: 120, bad_lines: 0, unparsed: 0 }], messages: [], tool_results: { count: 4, bytes: 9000 } });
  for (const [m, event] of [[0, 'UserPromptSubmit'], [30, 'Stop']]) {
    appendEvent(env, makeEvent({ source: 'hook', event, tool: 'claude-code', session_id: loose, project_id: null, project_source: 'none' }, at(11, m)), loose);
  }
  for (let k = 0; k < 4; k++) respond(loose, at(11, 2 + k * 6), MODELS.strong);

  for (const [day, five, week] of [[6, 38, 41], [13, 22, 67]]) {
    appendEvent(env, makeEvent({ source: 'cli', event: 'quota.snapshot', data: { source: 'manual', plan: 'max-5x', five_hour_pct: five, seven_day_pct: week, seven_day_resets_at: at(day + 3, 0).toISOString() } }, at(day, 480)));
  }

  mkdirSync(dataPath(env, 'usage'), { recursive: true });
  for (const [id, doc] of usageDocs) writeFileSync(dataPath(env, 'usage', `${id}.json`), `${JSON.stringify(doc, null, 2)}\n`);
}

/** Builds the sample in a throw-away metrics directory and writes the reports to `outDir`. */
export function makeSample(outDir) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'asdk-sample-'));
  try {
    const env = { ...process.env, AGENTIC_METRICS_HOME: home };
    writeSampleData(env);
    return writeReports(env, { now: SAMPLE_NOW, outDir });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
