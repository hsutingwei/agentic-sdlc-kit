import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox } from '../../test/helpers/sandbox.mjs';
import { appendEvent, eventsDir, makeEvent, readEvents } from '../lib/store.mjs';

const at = (iso) => new Date(iso);

test('makeEvent fills version and time and drops empty fields', () => {
  const e = makeEvent({ source: 'cli', event: 'task.start', task_id: undefined, project_id: null, data: { a: 1, b: undefined } }, at('2026-11-02T01:00:00Z'));
  assert.deepEqual(e, { schema_version: 1, ts: '2026-11-02T01:00:00.000Z', source: 'cli', event: 'task.start', project_id: null, data: { a: 1 } });
});

test('events are appended per month and stream and read back oldest first', (t) => {
  const sb = createSandbox(t, 'store');
  appendEvent(sb.env, makeEvent({ source: 'cli', event: 'task.end', task_id: 'DEMO-001' }, at('2026-12-01T00:00:00Z')));
  appendEvent(sb.env, makeEvent({ source: 'hook', event: 'SessionStart', session_id: 's-1' }, at('2026-11-30T23:00:00Z')), 's-1');
  appendEvent(sb.env, makeEvent({ source: 'cli', event: 'task.start', task_id: 'DEMO-001' }, at('2026-11-30T22:00:00Z')));

  assert.ok(existsSync(path.join(eventsDir(sb.env), '2026-11', '_manual.jsonl')));
  assert.ok(existsSync(path.join(eventsDir(sb.env), '2026-11', 's-1.jsonl')));
  assert.ok(existsSync(path.join(eventsDir(sb.env), '2026-12', '_manual.jsonl')));
  const { events, invalid } = readEvents(sb.env);
  assert.equal(invalid, 0);
  assert.deepEqual(events.map((e) => e.event), ['task.start', 'SessionStart', 'task.end']);
});

test('appending never rewrites earlier lines', (t) => {
  const sb = createSandbox(t, 'store-append');
  appendEvent(sb.env, makeEvent({ source: 'cli', event: 'a' }, at('2026-11-02T00:00:00Z')));
  const file = path.join(eventsDir(sb.env), '2026-11', '_manual.jsonl');
  const before = readFileSync(file, 'utf8');
  appendEvent(sb.env, makeEvent({ source: 'cli', event: 'b' }, at('2026-11-02T00:00:01Z')));
  assert.ok(readFileSync(file, 'utf8').startsWith(before));
});

test('invalid events are refused before anything is written', (t) => {
  const sb = createSandbox(t, 'store-invalid');
  assert.throws(() => appendEvent(sb.env, makeEvent({ source: 'cli', event: 'x', data: { prompt: 'p'.repeat(300) } })), /invalid event: \/data\/prompt/);
  assert.throws(() => appendEvent(sb.env, makeEvent({ source: 'cli', event: 'x' }), '../escape'), /stream name/);
  assert.equal(existsSync(eventsDir(sb.env)), false);
});

test('damaged lines are counted, not fatal', (t) => {
  const sb = createSandbox(t, 'store-damaged');
  appendEvent(sb.env, makeEvent({ source: 'cli', event: 'ok' }, at('2026-11-02T00:00:00Z')));
  appendFileSync(path.join(eventsDir(sb.env), '2026-11', '_manual.jsonl'), '{"half": \n{"schema_version":1}\n');
  const { events, invalid } = readEvents(sb.env);
  assert.equal(events.length, 1);
  assert.equal(invalid, 2);
});

test('damaged lines are located, and streams can be read on their own', (t) => {
  const sb = createSandbox(t, 'store-streams');
  appendEvent(sb.env, makeEvent({ source: 'cli', event: 'task.start' }, at('2026-11-02T00:00:00Z')));
  appendEvent(sb.env, makeEvent({ source: 'hook', event: 'Stop', session_id: 's1' }, at('2026-11-02T00:01:00Z')), 's1');
  appendFileSync(path.join(eventsDir(sb.env), '2026-11', 's1.jsonl'), 'torn\n');

  const all = readEvents(sb.env);
  assert.equal(all.events.length, 2);
  assert.deepEqual(all.damaged, [{ file: '2026-11/s1.jsonl', line: 2 }]);

  const manual = readEvents(sb.env, { streams: ['_manual'] });
  assert.deepEqual(manual.events.map((e) => e.event), ['task.start']);
  assert.deepEqual(manual.damaged, []);
});

test('each stream keeps its line order even when clocks disagree by a few milliseconds', (t) => {
  const sb = createSandbox(t, 'store-order');
  const ev = (name, ts, stream) => appendEvent(sb.env, makeEvent({ source: 'cli', event: name }, at(ts)), stream);
  // Written in this order by processes whose clocks are slightly out of step.
  ev('human.start', '2026-11-02T09:00:00.340Z');
  ev('human.stop', '2026-11-02T09:00:00.339Z');
  ev('human.start', '2026-11-02T09:00:00.340Z');
  // Another stream is still interleaved by time.
  ev('Stop', '2026-11-02T09:00:00.100Z', 's1');
  ev('SessionEnd', '2026-11-02T09:00:00.900Z', 's1');

  assert.deepEqual(
    readEvents(sb.env).events.map((e) => e.event),
    ['Stop', 'human.start', 'human.stop', 'human.start', 'SessionEnd'],
  );
});
