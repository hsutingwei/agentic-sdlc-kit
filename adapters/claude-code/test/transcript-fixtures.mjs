// Builds fictional Claude Code transcripts in the record shapes seen in the spike
// (docs/spike, finding 7). Nothing here comes from a real transcript.

export const SECRET = 'TOP-SECRET-CONTENT';

let clock = Date.UTC(2026, 10, 2, 9, 0, 0);
const tick = () => new Date((clock += 1000)).toISOString();

/** One API response written as `copies` records that share message.id and requestId. */
export function response({ messageId, requestId, model = 'claude-opus-5-5', usage, copies = 1, agentId, effort = 'high', version = '2.1.330' }) {
  const records = [];
  for (let i = 0; i < copies; i++) {
    records.push({
      type: 'assistant',
      uuid: `u-${messageId}-${i}`,
      sessionId: 'sess-fixture',
      timestamp: tick(),
      version,
      effort,
      isSidechain: Boolean(agentId),
      ...(agentId ? { agentId } : {}),
      requestId,
      message: {
        id: messageId,
        model,
        role: 'assistant',
        type: 'message',
        content: [{ type: 'text', text: `${SECRET} answer ${i}` }],
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, service_tier: 'standard', ...usage },
      },
    });
  }
  return records;
}

export function toolResult(content) {
  return {
    type: 'user',
    uuid: `t-${clock}`,
    sessionId: 'sess-fixture',
    timestamp: tick(),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content }] },
  };
}

/** Record types the kit ignores, in their real shapes but with fictional values. */
export const NOISE = [
  { type: 'custom-title', customTitle: SECRET, sessionId: 'sess-fixture' },
  { type: 'attachment', attachment: { content: SECRET }, sessionId: 'sess-fixture', timestamp: '2026-11-02T09:00:00.000Z' },
  { type: 'api-request-blob', hash: 'h', message: { role: 'user', content: SECRET }, sessionId: 'sess-fixture' },
  { type: 'something-new-in-a-later-version', sessionId: 'sess-fixture' },
];

export const jsonl = (records) => `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
