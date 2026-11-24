// Local state under ~/.agentic-metrics/state/. Never exported, never reported.
// A worktree marker tells the hook which task a worktree belongs to without
// reading the whole event log on every hook call.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataPath } from './paths.mjs';

const markerFile = (env, projectId, slot) => dataPath(env, 'state', 'worktrees', `${projectId}__${slot}.json`);

export function writeWorktreeMarker(env, marker) {
  const file = markerFile(env, marker.project_id, marker.slot);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(marker, null, 2)}\n`);
  renameSync(tmp, file);
}

export function readWorktreeMarker(env, projectId, slot) {
  const file = markerFile(env, projectId, slot);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function removeWorktreeMarker(env, projectId, slot) {
  rmSync(markerFile(env, projectId, slot), { force: true });
}
