import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEvent } from '../lib/store.mjs';
import { hoursWithin, sessionIntervals, taskAiTime, union } from '../lib/turns.mjs';

const T = (min) => new Date(Date.UTC(2026, 10, 2, 9, 0) + min * 60000);
const hook = (event, session, min, agent) => makeEvent({ source: 'hook', event, session_id: session, project_id: 'demo-api', task_id: 'DEMO-001', agent }, T(min));
const task = (sessions, from, to) => ({ sessions: new Set(sessions), started_at: T(from).toISOString(), ended_at: to === undefined ? undefined : T(to).toISOString() });

test('turns and background sub-agents count, overlapping time once', () => {
  const a = { id: 'a-1', type: 'implementer' };
  const per = sessionIntervals([
    hook('UserPromptSubmit', 's1', 0),
    hook('SubagentStart', 's1', 5, a),
    hook('PreToolUse', 's1', 6, a), // tool calls inside the sub-agent are not intervals
    hook('Stop', 's1', 10), // the turn ends while the sub-agent keeps working
    hook('SubagentStop', 's1', 40, a),
    hook('UserPromptSubmit', 's1', 60),
    hook('Stop', 's1', 70),
  ]);
  assert.deepEqual(per.get('s1').unpaired, 0);
  const r = taskAiTime(per, task(['s1'], 0, 120));
  assert.equal(r.ai_h, Math.round((50 / 60) * 100) / 100); // 0-40 and 60-70
  assert.equal(r.concurrent, false);
});

test('a turn crossing the task boundary is clipped, not dropped', () => {
  const per = sessionIntervals([hook('UserPromptSubmit', 's1', 0), hook('Stop', 's1', 60)]);
  assert.equal(taskAiTime(per, task(['s1'], 30, 120)).ai_h, 0.5);
  assert.equal(taskAiTime(per, task(['s1'], -60, 15)).ai_h, 0.25);
  assert.equal(taskAiTime(per, task(['s1'], 90, 120)).ai_h, 0);
});

test('unfinished turns end at the session’s last event and are counted as unpaired', () => {
  const per = sessionIntervals([
    hook('UserPromptSubmit', 's1', 0),
    hook('UserPromptSubmit', 's1', 10), // the first turn never stopped
    hook('PreToolUse', 's1', 25),
  ]);
  assert.equal(per.get('s1').unpaired, 2);
  assert.equal(taskAiTime(per, task(['s1'], 0, 120)).ai_h, Math.round((25 / 60) * 100) / 100);
  assert.equal(taskAiTime(per, task(['s1'], 0, 120)).unpaired, 2);
});

test('two sessions working at once on a task are reported', () => {
  const per = sessionIntervals([
    hook('UserPromptSubmit', 's1', 0),
    hook('UserPromptSubmit', 's2', 10),
    hook('Stop', 's1', 20),
    hook('Stop', 's2', 30),
  ]);
  const r = taskAiTime(per, task(['s1', 's2'], 0, 60));
  assert.equal(r.concurrent, true);
  assert.equal(r.ai_h, 0.5);
  assert.equal(taskAiTime(per, task(['s1'], 0, 60)).concurrent, false);
});

test('open tasks run to now; union and hoursWithin', () => {
  const per = sessionIntervals([hook('UserPromptSubmit', 's1', 0), hook('Stop', 's1', 30)]);
  assert.equal(taskAiTime(per, task(['s1'], 0), T(15).getTime()).ai_h, 0.25);
  assert.deepEqual(union([[5, 9], [1, 3], [2, 4], [9, 10]]), [[1, 4], [5, 10]]);
  const periods = [{ from: T(10).toISOString(), to: T(40).toISOString() }, { from: T(50).toISOString() }];
  assert.equal(hoursWithin(periods, task([], 0, 60)), Math.round((40 / 60) * 100) / 100);
});
