// Named locks under ~/.agentic-metrics/locks/ for the collector's read -> check -> write steps.
//
//   tasks            task and human-time changes (the check reads the log, then appends)
//   config           config.json read-modify-write
//   recording        the enable/disable switch
//   claude-settings  Claude Code settings edits and their install records
//
// Hooks take no lock: they only append and never check.

import { withLock } from '../../core/lock.mjs';
import { dataPath } from './paths.mjs';

export const lockFile = (env, name) => dataPath(env, 'locks', `${name}.lock`);

// Locks this process holds, so a locked step can call another step that takes the same lock.
const held = new Set();

export function withCollectorLock(env, name, fn) {
  const file = lockFile(env, name);
  if (held.has(file)) return fn();
  // Only tests shorten the wait.
  const ms = Number(env.AGENTIC_LOCK_TIMEOUT_MS);
  const options = { label: `the ${name} lock`, ...(Number.isInteger(ms) && ms > 0 ? { timeoutMs: ms } : {}) };
  return withLock(
    file,
    () => {
      held.add(file);
      try {
        return fn();
      } finally {
        held.delete(file);
      }
    },
    options,
  );
}
