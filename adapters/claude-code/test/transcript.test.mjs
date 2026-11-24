import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentMeta, parseTranscript } from '../transcript.mjs';
import { jsonl, NOISE, response, SECRET, toolResult } from './transcript-fixtures.mjs';

test('one response written several times counts once', () => {
  const text = jsonl([
    ...response({ messageId: 'msg_1', requestId: 'req_1', copies: 3, usage: { input_tokens: 10, output_tokens: 151, cache_read_input_tokens: 5000 } }),
    ...response({ messageId: 'msg_2', requestId: 'req_2', copies: 2, usage: { input_tokens: 4, output_tokens: 151, cache_creation_input_tokens: 800 } }),
    ...response({ messageId: 'msg_3', requestId: 'req_3', usage: { output_tokens: 151 } }),
  ]);
  const r = parseTranscript(text);
  assert.equal(r.messages.size, 3);
  const rows = [...r.messages.values()];
  // A naive sum over records would give 151 * 6 output tokens.
  assert.equal(rows.reduce((n, m) => n + m.output_tokens, 0), 453);
  assert.deepEqual(
    rows.map((m) => [m.input_tokens, m.cache_write_tokens, m.cache_read_tokens]),
    [[10, 0, 5000], [4, 800, 0], [0, 0, 0]],
  );
  assert.equal(rows[0].model, 'claude-opus-5-5');
  assert.equal(rows[0].effort, 'high');
  assert.deepEqual([...r.versions], ['2.1.330']);
});

test('copies that differ keep the largest counters', () => {
  const [first, second] = response({ messageId: 'msg_1', requestId: 'req_1', copies: 2, usage: { output_tokens: 1 } });
  second.message.usage.output_tokens = 90; // the last copy of a streamed response
  const [row] = parseTranscript(jsonl([first, second])).messages.values();
  assert.equal(row.output_tokens, 90);
});

test('sub-agent records keep their agent id; tool results keep only their size', () => {
  const r = parseTranscript(
    jsonl([
      ...response({ messageId: 'msg_a', requestId: 'req_a', agentId: 'a335511527b9d0f06', model: 'claude-haiku-5-5', usage: { output_tokens: 7 } }),
      toolResult(`${SECRET} 中文`),
      toolResult([{ type: 'text', text: SECRET }]),
    ]),
  );
  const [row] = r.messages.values();
  assert.equal(row.agent_id, 'a335511527b9d0f06');
  assert.equal(r.tool_results.count, 2);
  assert.ok(r.tool_results.bytes > SECRET.length * 2);
  assert.doesNotMatch(JSON.stringify({ rows: [...r.messages.values()], tools: r.tool_results }), new RegExp(SECRET));
});

test('other record types are skipped, broken lines and odd assistant records are counted', () => {
  const odd = { type: 'assistant', timestamp: '2026-11-02T09:00:00.000Z', message: { content: [] } };
  const r = parseTranscript(`${jsonl([...NOISE, odd, ...response({ messageId: 'm', requestId: 'q', usage: { output_tokens: 1 } })])}{"type":"assist\n`);
  assert.equal(r.messages.size, 1);
  assert.equal(r.unparsed, 1);
  assert.equal(r.bad_lines, 1);
  assert.equal(r.lines, NOISE.length + 3);
});

test('agent meta keeps type and model, never the description', () => {
  const meta = parseAgentMeta(JSON.stringify({ agentType: 'implementer', model: 'claude-sonnet-5-5', description: SECRET, spawnDepth: 1, finished: true }));
  assert.deepEqual(meta, { agent_type: 'implementer', model: 'claude-sonnet-5-5' });
  assert.deepEqual(parseAgentMeta('not json'), {});
});
