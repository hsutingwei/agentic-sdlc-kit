// asdk health: is recording actually working on this machine?
//
// Each check reports ok, warn or fail. Only fail makes the exit status 1: a
// warning (recording paused, no events yet) can be the intended state.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from '../../core/cli.mjs';
import { ASDK_BIN, HOOK_EVENTS, inspectHooks } from '../../adapters/claude-code/install.mjs';
import { dataPath, metricsHome } from '../lib/paths.mjs';
import { recordingState } from '../lib/recording.mjs';
import { loadConfig } from '../lib/registry.mjs';
import { readEvents } from '../lib/store.mjs';

const MIN_NODE_MAJOR = 22;
const SLOW_HOOK_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ok = (name, detail) => ({ name, status: 'ok', detail });
const warn = (name, detail) => ({ name, status: 'warn', detail });
const fail = (name, detail) => ({ name, status: 'fail', detail });

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= MIN_NODE_MAJOR ? ok('node', process.versions.node) : fail('node', `${process.versions.node}; ${MIN_NODE_MAJOR} or newer is required`);
}

function checkDataDir(env) {
  const dir = metricsHome(env);
  try {
    mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.health-${process.pid}`);
    writeFileSync(probe, '');
    rmSync(probe);
    return ok('data directory', dir);
  } catch (err) {
    return fail('data directory', `${dir} is not writable (${err.code ?? err.message})`);
  }
}

function checkConfig(env) {
  let config;
  try {
    config = loadConfig(env);
  } catch (err) {
    return fail('projects', err.message);
  }
  const missing = config.projects.filter((p) => !existsSync(p.root)).map((p) => p.id);
  if (config.projects.length === 0) return warn('projects', 'none registered (asdk project add <id> <root>)');
  if (missing.length) return warn('projects', `root missing for: ${missing.join(', ')}`);
  const unregistered = config.record_unregistered === false ? '; events outside them are dropped' : '';
  return ok('projects', `${config.projects.length} registered${unregistered}`);
}

function checkRecording(env) {
  const state = recordingState(env);
  if (state.enabled) return ok('recording', 'enabled');
  return warn('recording', `disabled${state.since ? ` since ${state.since}` : ''}${state.reason ? ` (${state.reason})` : ''}; asdk enable resumes it`);
}

function checkHooks(env, target) {
  const name = `hooks (${target.scope})`;
  let r;
  try {
    r = inspectHooks(env, target);
  } catch (err) {
    return fail(name, err.message);
  }
  if (r.error) return fail(name, r.error);
  const extra = [r.duplicates && `${r.duplicates} duplicate(s)`, r.stale && `${r.stale} entr${r.stale === 1 ? 'y' : 'ies'} for another kit path`].filter(Boolean);
  const tail = extra.length ? `; ${extra.join(', ')}` : '';
  if (r.installed.length === 0) return warn(name, `not installed in ${r.file}${tail}`);
  if (r.missing.length) return fail(name, `missing ${r.missing.join(', ')} in ${r.file}; run asdk hooks install${tail}`);
  return extra.length ? warn(name, `${HOOK_EVENTS.length}/${HOOK_EVENTS.length} in ${r.file}${tail}`) : ok(name, `${HOOK_EVENTS.length}/${HOOK_EVENTS.length} in ${r.file}`);
}

function checkErrorLog(env, now) {
  const file = dataPath(env, 'collector-errors.log');
  if (!existsSync(file)) return ok('hook errors', 'none logged');
  const recent = readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => {
      const ts = Date.parse(line.slice(0, 24));
      return Number.isFinite(ts) && now - ts < DAY_MS;
    });
  if (recent.length === 0) return ok('hook errors', 'none in the last 24 hours');
  return warn('hook errors', `${recent.length} in the last 24 hours; last: ${recent.at(-1).slice(25)}`);
}

function checkEvents(env) {
  const { events, invalid } = readEvents(env);
  const last = events.filter((e) => e.source === 'hook').at(-1);
  const results = [last ? ok('last hook event', `${last.ts} (${last.event})`) : warn('last hook event', 'none recorded yet; start a Claude Code session after installing the hooks')];
  if (invalid > 0) results.push(warn('event lines', `${invalid} line(s) could not be read and are ignored`));
  return results;
}

/** Runs the hook once against a throw-away data directory and times it. */
function checkProbe(env) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'asdk-health-'));
  try {
    const started = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [ASDK_BIN, 'hook'], {
      env: { ...env, AGENTIC_METRICS_HOME: dir },
      input: JSON.stringify({ hook_event_name: 'Notification', session_id: 'asdk-health-probe', cwd: dir }),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
    });
    const ms = Number((process.hrtime.bigint() - started) / 1000000n);
    const recorded = readEvents({ ...env, AGENTIC_METRICS_HOME: dir }).events.length === 1;
    if (r.status !== 0 || !recorded) return fail('hook probe', `the hook ran but recorded nothing (exit ${r.status}); see ${path.join(dir, 'collector-errors.log')}`);
    return ms > SLOW_HOOK_MS ? warn('hook probe', `${ms} ms per call; every tool call waits for it`) : ok('hook probe', `${ms} ms per call`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function runChecks(env, { target = { scope: 'user' }, now = Date.now() } = {}) {
  return [checkNode(), checkDataDir(env), checkConfig(env), checkRecording(env), checkHooks(env, target), checkErrorLog(env, now), ...checkEvents(env), checkProbe(env)];
}

export async function runHealth(argv, { env, cwd, out }) {
  const usage = 'asdk health [--scope user|local] [--project <dir>] [--json]';
  const { values } = parse(argv, { scope: { type: 'string' }, project: { type: 'string' }, json: { type: 'boolean' } }, { usage });
  const checks = runChecks(env, { target: { scope: values.scope ?? 'user', project: values.project, cwd } });
  if (values.json) out(JSON.stringify(checks));
  else for (const c of checks) out(`${c.status.padEnd(5)}${c.name}: ${c.detail}`);
  return checks.some((c) => c.status === 'fail') ? 1 : 0;
}
