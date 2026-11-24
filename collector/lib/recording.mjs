// Recording on/off switch. Disabling does not touch Claude Code's settings: the
// hook stays installed and returns at once while a state file exists. Turning
// recording off and on again is itself recorded, so reports can mark the gap.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { usageError } from '../../core/errors.mjs';
import { withCollectorLock } from './locks.mjs';
import { dataPath } from './paths.mjs';
import { appendEvent, makeEvent } from './store.mjs';

export const disabledFile = (env) => dataPath(env, 'state', 'recording-disabled.json');

/** Cheap check for the hook path: one stat call. */
export const isRecordingDisabled = (env) => existsSync(disabledFile(env));

export function recordingState(env) {
  const file = disabledFile(env);
  if (!existsSync(file)) return { enabled: true };
  try {
    const { since, reason } = JSON.parse(readFileSync(file, 'utf8'));
    return { enabled: false, since, reason };
  } catch {
    return { enabled: false }; // unreadable, but its presence is what counts
  }
}

/** @returns {boolean} false when recording was already disabled */
export function disableRecording(env, { reason, now = new Date() } = {}) {
  if (reason !== undefined && reason.length > 256) throw usageError('--reason must be at most 256 characters');
  return withCollectorLock(env, 'recording', () => disableLocked(env, reason, now));
}

function disableLocked(env, reason, now) {
  if (isRecordingDisabled(env)) return false;
  appendEvent(env, makeEvent({ source: 'cli', event: 'recording.disable', data: reason ? { reason } : undefined }, now));
  const file = disabledFile(env);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ since: now.toISOString(), reason: reason ?? null }, null, 2)}\n`);
  renameSync(tmp, file);
  return true;
}

/** @returns {boolean} false when recording was already enabled */
export function enableRecording(env, { now = new Date() } = {}) {
  return withCollectorLock(env, 'recording', () => enableLocked(env, now));
}

function enableLocked(env, now) {
  const state = recordingState(env);
  if (state.enabled) return false;
  rmSync(disabledFile(env), { force: true });
  appendEvent(env, makeEvent({ source: 'cli', event: 'recording.enable', data: state.since ? { disabled_since: state.since } : undefined }, now));
  return true;
}
