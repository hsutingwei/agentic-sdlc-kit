import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowsFromStreamJson } from '../rate-limit.mjs';

// The structure seen from Claude Code 2.1.330 (docs/spike, finding 8), with fictional values.
const event = (utilization, resetsAt) =>
  JSON.stringify({
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed',
      resetsAt,
      rateLimitType: 'seven_day',
      overageStatus: 'rejected',
      overageDisabledReason: 'org_level_disabled',
      isUsingOverage: false,
      unifiedWindows: { seven_day: { utilization, resetsAt, status: 'allowed' }, five_hour: { utilization: 0.125, resetsAt: resetsAt - 3600, status: 'allowed' } },
    },
    uuid: 'u-1',
    session_id: 's-1',
  });

test('the last rate_limit_event gives the windows, nothing else', () => {
  const text = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    event(0.2, 1795000000),
    'not json',
    event(0.634, 1795003600),
    JSON.stringify({ type: 'result', result: 'OK' }),
  ].join('\n');
  assert.deepEqual(windowsFromStreamJson(text), [
    { name: 'seven_day', used_pct: 63.4, resets_at: new Date(1795003600 * 1000).toISOString() },
    { name: 'five_hour', used_pct: 12.5, resets_at: new Date((1795003600 - 3600) * 1000).toISOString() },
  ]);
});

test('no rate_limit_event means no windows', () => {
  assert.equal(windowsFromStreamJson('{"type":"result"}\n'), null);
  assert.deepEqual(windowsFromStreamJson(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: {} })), []);
});
