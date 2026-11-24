// Push check (spec A8): for a project with a push check configured, compare the
// commits pushed to its main branch with gate passes recorded for the same SHA.
//
//   pass        a passing run of the configured gate finished before the push
//   after_push  a passing run exists, but only from after the push
//   failed      runs exist, none passed
//   missing     no run of that gate for that commit
//
// Push times come from git.push events written by the pre-push hook
// (`asdk push-check install-hook`); without them, from the reflog of the
// remote-tracking branch, marked as approximate (the time it was fetched or
// pushed from this clone).

import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ruleError, usageError } from '../../core/errors.mjs';
import { git, tryGit } from '../../core/git.mjs';
import { loadGateConfig, pushCheckConfig } from '../../governance/gate/gate.mjs';
import { dataPath } from './paths.mjs';
import { findProject, loadConfig, resolveProject } from './registry.mjs';
import { appendEvent, makeEvent, MANUAL_STREAM, readEvents } from './store.mjs';

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const ZERO = /^0+$/;
export const HOOK_MARK = '# asdk push-check hook';

function projectContext(env, { projectId, cwd }) {
  let root;
  let id = projectId;
  if (projectId) {
    const p = findProject(loadConfig(env), projectId);
    if (!p) throw usageError(`unknown project "${projectId}"`);
    root = p.root;
  } else {
    const r = resolveProject(cwd, { env });
    if (!r.project_id) throw usageError('not inside a registered project; pass --project');
    id = r.project_id;
    root = r.root;
  }
  const settings = pushCheckConfig(loadGateConfig(root));
  if (!settings) throw usageError(`${id}: no "push_check" in .asdk/gates.json`);
  return { id, root, settings };
}

/**
 * Called by the pre-push hook: checks each commit pushed to the checked branch for a passing gate
 * run. Without one it warns, or with `"block": true` refuses the push; a refused push is not
 * recorded. Pushes that go ahead are recorded as git.push events.
 * @param {string} refsText the hook's stdin: "<local ref> <local sha> <remote ref> <remote sha>" per line
 * @returns {{ warnings: string[], refused: string[] }}
 */
export function recordPush(env, { cwd, remote, refsText, now = new Date() }) {
  const result = { warnings: [], refused: [] };
  let ctx;
  try {
    ctx = projectContext(env, { cwd });
  } catch {
    return result; // not a checked project: nothing to do
  }
  if (remote !== ctx.settings.remote) return result;
  const pushes = [];
  for (const line of refsText.split(/\r?\n/)) {
    const [, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (remoteRef !== `refs/heads/${ctx.settings.branch}` || !SHA.test(localSha ?? '') || ZERO.test(localSha)) continue;
    pushes.push({ localSha, remoteSha });
    if (gateRuns(env, ctx, localSha).some((r) => r.result === 'pass')) continue;
    const { gate, branch } = ctx.settings;
    if (ctx.settings.block) result.refused.push(`${localSha.slice(0, 12)} has no passing ${gate} run; run "asdk gate run ${gate}" on that commit, then push again`);
    else result.warnings.push(`${localSha.slice(0, 12)} is being pushed to ${branch} without a passing ${gate} run (asdk gate run ${gate})`);
  }
  if (result.refused.length) return result; // git refuses the whole push
  for (const { localSha, remoteSha } of pushes) {
    appendEvent(
      env,
      makeEvent(
        {
          source: 'cli',
          event: 'git.push',
          project_id: ctx.id,
          data: { remote, branch: ctx.settings.branch, head_sha: localSha, previous_sha: SHA.test(remoteSha ?? '') && !ZERO.test(remoteSha) ? remoteSha : undefined },
        },
        now,
      ),
    );
  }
  return result;
}

/** Passing and failing runs of the configured gate (and runners) for one commit. */
function gateRuns(env, ctx, sha) {
  const dir = dataPath(env, 'gates', ctx.id, sha);
  if (!existsSync(dir)) return [];
  const runs = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const s = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (s.gate !== ctx.settings.gate || s.head_sha !== sha) continue;
      if (ctx.settings.runners && !ctx.settings.runners.includes(s.runner?.id)) continue;
      runs.push({ result: s.result, finished_at: s.finished_at, runner: s.runner?.id });
    } catch {
      // a damaged summary counts as no run
    }
  }
  return runs.sort((a, b) => (a.finished_at < b.finished_at ? -1 : 1));
}

/** First-parent commits of the remote-tracking branch, newest first. */
function pushedCommits(ctx, env, limit) {
  const ref = `refs/remotes/${ctx.settings.remote}/${ctx.settings.branch}`;
  const r = tryGit(['log', '--first-parent', `--max-count=${limit}`, '--format=%H', ref], { cwd: ctx.root, env });
  if (!r.ok) throw ruleError(`${ref} does not exist in ${ctx.id}; fetch or push first`);
  return r.stdout.split('\n').filter(Boolean);
}

/** Commit -> { at, source } from recorded pushes, then from the remote-tracking reflog. */
function pushTimes(ctx, env, events) {
  const times = new Map();
  const range = (from, to) => {
    const spec = from ? `${from}..${to}` : to;
    const r = tryGit(['rev-list', '--first-parent', spec], { cwd: ctx.root, env });
    return r.ok ? r.stdout.split('\n').filter(Boolean) : [to];
  };
  const pushes = events.filter((e) => e.event === 'git.push' && e.project_id === ctx.id && e.data?.branch === ctx.settings.branch);
  for (const e of pushes) {
    for (const sha of range(e.data.previous_sha, e.data.head_sha)) if (!times.has(sha)) times.set(sha, { at: e.ts, source: 'hook' });
  }
  const ref = `refs/remotes/${ctx.settings.remote}/${ctx.settings.branch}`;
  const log = tryGit(['reflog', 'show', '--date=iso-strict', '--format=%H%x09%gd', ref], { cwd: ctx.root, env });
  if (log.ok) {
    const entries = log.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sha, sel] = l.split('\t');
        return { sha, at: /\{(.+)\}$/.exec(sel)?.[1] };
      })
      .reverse(); // oldest first
    let previous = null;
    for (const entry of entries) {
      const at = entry.at && !Number.isNaN(Date.parse(entry.at)) ? new Date(Date.parse(entry.at)).toISOString() : null;
      for (const sha of range(previous, entry.sha)) if (!times.has(sha) && at) times.set(sha, { at, source: 'reflog' });
      previous = entry.sha;
    }
  }
  return times;
}

/**
 * @returns {{ project_id: string, branch: string, gate: string, commits: { sha, pushed_at, push_time_source, status, runs }[], counts: Record<string, number> }}
 */
export function checkPushes(env, { projectId, cwd, limit = 50 }) {
  const ctx = projectContext(env, { projectId, cwd });
  const { events } = readEvents(env, { streams: [MANUAL_STREAM] });
  const times = pushTimes(ctx, env, events);
  const commits = pushedCommits(ctx, env, limit).map((sha) => {
    const runs = gateRuns(env, ctx, sha);
    const pushed = times.get(sha) ?? null;
    const passes = runs.filter((r) => r.result === 'pass');
    let status;
    if (runs.length === 0) status = 'missing';
    else if (passes.length === 0) status = 'failed';
    // The reflog keeps whole seconds: its time stands for the end of that second.
    else if (pushed && passes.every((r) => Date.parse(r.finished_at) > Date.parse(pushed.at) + (pushed.source === 'reflog' ? 999 : 0))) status = 'after_push';
    else status = 'pass';
    return { sha, pushed_at: pushed?.at ?? null, push_time_source: pushed?.source ?? null, status, runs: runs.length };
  });
  const counts = { pass: 0, after_push: 0, failed: 0, missing: 0 };
  for (const c of commits) counts[c.status]++;
  return { project_id: ctx.id, branch: ctx.settings.branch, gate: ctx.settings.gate, commits, counts };
}

/** The hook script: runs the kit's node and asdk with the hook's arguments. */
export function hookScript(asdk, node = process.execPath) {
  const q = (p) => `"${p.split(path.sep).join('/')}"`;
  return `#!/bin/sh\n${HOOK_MARK} (remove with: asdk push-check remove-hook)\nexec ${q(node)} ${q(asdk)} push-check record "$@"\n`;
}

function hooksDir(root, env) {
  return path.resolve(root, git(['rev-parse', '--git-path', 'hooks'], { cwd: root, env }));
}

/** Installs the pre-push hook; refuses to replace a pre-push hook that is not the kit's. */
export function installPushHook(env, { projectId, cwd, asdk }) {
  const ctx = projectContext(env, { projectId, cwd });
  const file = path.join(hooksDir(ctx.root, env), 'pre-push');
  if (existsSync(file) && !readFileSync(file, 'utf8').includes(HOOK_MARK)) {
    throw ruleError(`${file} already exists and is not the kit's; add "asdk push-check record \\"$@\\"" to it yourself`);
  }
  writeFileSync(file, hookScript(asdk));
  chmodSync(file, 0o755);
  return file;
}

export function removePushHook(env, { projectId, cwd }) {
  const ctx = projectContext(env, { projectId, cwd });
  const file = path.join(hooksDir(ctx.root, env), 'pre-push');
  if (!existsSync(file)) return null;
  if (!readFileSync(file, 'utf8').includes(HOOK_MARK)) throw ruleError(`${file} is not the kit's hook; leaving it`);
  rmSync(file);
  return file;
}
