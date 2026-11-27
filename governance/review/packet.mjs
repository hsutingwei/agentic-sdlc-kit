// The review packet: everything a sterile reviewer may see, written to a folder
// outside the repository. The brief comes from the reviewed commit itself, the diff
// is against the merge base with the integration branch, and the checks are only
// those recorded for that exact commit, plus the kit's scope check of the diff.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleError } from '../../core/errors.mjs';
import { git, tryGit } from '../../core/git.mjs';
import { shortenLongLines } from '../../core/text.mjs';
import { dataPath } from '../../collector/lib/paths.mjs';
import { briefPath, readBrief } from '../gate/brief.mjs';
import { scopeCheck } from '../gate/scope.mjs';

export const INSTRUCTIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'reviewer.md');
const MAX_FILE_BYTES = 200 * 1024;
const PACKET_NOTE = 'whole line in the repository';

/** The task brief as it is in `sha`; the brief is the reviewer's definition of done. */
export function briefAt(env, { repo, sha, taskId }) {
  const found = readBrief(env, { repo, ref: sha, taskId });
  if (!found) throw ruleError(`${briefPath(taskId)} is not in the reviewed commit; the reviewer needs the brief and its acceptance criteria`);
  return found;
}

/** What already ran on `sha`: gate runs, recorded checks and the scenarios of its evidence. */
export function checksAt(env, { task, sha }) {
  const gates = task.gate_runs.filter((g) => g.sha === sha).map((g) => ({ gate: g.gate, result: g.result }));
  const recorded = task.verifications.filter((v) => v.sha === sha && v.check !== 'review' && v.check !== 'acceptance').map((v) => ({ check: v.check, result: v.result, executor: v.executor }));
  const evidence = [];
  const dir = dataPath(env, 'evidence', task.project_id, sha);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        const e = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
        if (e.head_sha !== sha || e.tree_clean !== true) continue;
        for (const s of e.scenarios ?? []) {
          const failed = (s.steps ?? []).filter((x) => x.result !== 'pass').map((x) => x.name);
          evidence.push({ scenario: s.name, criteria: s.criteria ?? [], result: s.result, steps: (s.steps ?? []).length, ...(failed.length ? { failed_steps: failed } : {}) });
        }
      } catch {
        // an unreadable evidence file is left out
      }
    }
  }
  return { gates, recorded, scenarios: evidence };
}

/**
 * Writes the packet for one reviewer run into `dir` (created; must not exist yet).
 * @returns {{ dir: string, files: string[], changed: string[], brief: object, scope: object }}
 */
export function writePacket(env, { dir, repo, sha, base, taskId, checks = { gates: [], recorded: [], scenarios: [] }, language }) {
  if (existsSync(dir)) throw ruleError(`${dir} already exists`);
  mkdirSync(path.join(dir, 'files'), { recursive: true });
  const { text: briefText, brief } = briefAt(env, { repo, sha, taskId });
  const mergeBase = git(['merge-base', base, sha], { cwd: repo, env });
  const diff = git(['diff', '--stat', '--patch', '--no-renames', mergeBase, sha], { cwd: repo, env });
  const changed = git(['diff', '--name-only', '--no-renames', '-z', mergeBase, sha], { cwd: repo, env }).split('\0').filter(Boolean);
  const scope = scopeCheck(brief, changed);

  const instructions = readFileSync(INSTRUCTIONS, 'utf8').replaceAll('{{LANGUAGE}}', language);
  writeFileSync(path.join(dir, 'instructions.md'), instructions);
  writeFileSync(path.join(dir, 'brief.json'), briefText);
  writeFileSync(path.join(dir, 'change.diff'), `${shortenLongLines(diff, { where: PACKET_NOTE })}\n`);
  writeFileSync(path.join(dir, 'checks.json'), `${JSON.stringify({ ...checks, scope }, null, 2)}\n`);

  const files = ['instructions.md', 'brief.json', 'change.diff', 'checks.json'];
  for (const rel of changed) {
    const shown = tryGit(['show', `${sha}:${rel}`], { cwd: repo, env });
    if (!shown.ok) continue; // deleted by the change
    if (Buffer.byteLength(shown.stdout) > MAX_FILE_BYTES || shown.stdout.includes('\0')) continue;
    const to = path.join(dir, 'files', ...rel.split('/'));
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, shortenLongLines(shown.stdout, { where: PACKET_NOTE }));
    files.push(`files/${rel}`);
  }
  return { dir, files, changed, brief, scope };
}
