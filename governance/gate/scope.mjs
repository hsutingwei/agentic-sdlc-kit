// The brief's scope, checked against the files a change touches.
//
//   "scope": { "allowed_paths": ["src/**", "test/**"], "forbidden_paths": [".asdk/**"] }
//
// A changed file is outside scope when it matches a forbidden path (whatever the
// allowed paths say) or matches no allowed path. Deleted and renamed files count,
// since changedPaths lists both sides of a rename. Nothing here needs a model: the
// answer follows from the brief and the diff alone.

import { matchesGlob } from '../../core/glob.mjs';

/**
 * @param {{ scope: { allowed_paths: string[], forbidden_paths?: string[] } }} brief
 * @param {string[]} changed repository-relative paths
 * @returns {{ allowed_paths: string[], forbidden_paths: string[], changed: number,
 *             outside: Array<{ path: string, reason: 'forbidden' | 'not_allowed', glob?: string }> }}
 */
export function scopeCheck(brief, changed) {
  const allowed = brief.scope?.allowed_paths ?? [];
  const forbidden = brief.scope?.forbidden_paths ?? [];
  const outside = [];
  for (const file of changed) {
    const banned = forbidden.find((glob) => matchesGlob(file, glob));
    if (banned) outside.push({ path: file, reason: 'forbidden', glob: banned });
    else if (!allowed.some((glob) => matchesGlob(file, glob))) outside.push({ path: file, reason: 'not_allowed' });
  }
  return { allowed_paths: allowed, forbidden_paths: forbidden, changed: changed.length, outside };
}
