import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox, makeRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { registerProject } from '../lib/registry.mjs';
import { disableRecording, enableRecording, isRecordingDisabled, recordingState } from '../lib/recording.mjs';
import { readEvents } from '../lib/store.mjs';

test('disable and enable are idempotent and leave a record of the gap', (t) => {
  const sb = createSandbox(t, 'rec-toggle');
  const off = new Date('2026-11-02T09:00:00Z');
  assert.equal(isRecordingDisabled(sb.env), false);
  assert.equal(disableRecording(sb.env, { reason: '處理私人專案', now: off }), true);
  assert.equal(disableRecording(sb.env), false);
  assert.deepEqual(recordingState(sb.env), { enabled: false, since: off.toISOString(), reason: '處理私人專案' });
  assert.equal(enableRecording(sb.env, { now: new Date('2026-11-02T10:00:00Z') }), true);
  assert.equal(enableRecording(sb.env), false);

  const events = readEvents(sb.env).events;
  assert.deepEqual(events.map((e) => e.event), ['recording.disable', 'recording.enable']);
  assert.equal(events[0].data.reason, '處理私人專案');
  assert.equal(events[1].data.disabled_since, off.toISOString());
});

test('the hook records nothing while recording is disabled', (t) => {
  const sb = createSandbox(t, 'rec-hook');
  const root = makeRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root });
  const payload = JSON.stringify({ session_id: 's', cwd: root, hook_event_name: 'Stop' });
  const hookEvents = () => readEvents(sb.env).events.filter((e) => e.source === 'hook').length;

  assert.equal(runAsdk(sb, ['disable', '--reason', 'demo']).status, 0);
  assert.equal(runAsdk(sb, ['hook'], { input: payload }).status, 0);
  assert.equal(hookEvents(), 0);

  const r = runAsdk(sb, ['enable']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /recording enabled/);
  assert.equal(runAsdk(sb, ['hook'], { input: payload }).status, 0);
  assert.equal(hookEvents(), 1);
});
