// Verification on the running application: start it, wait until it answers,
// drive it through scenarios over HTTP, keep the evidence, and stop it again.
//
// .asdk/verify.json (protected, like the gates) says how to launch the project:
//
//   { "schema_version": 1,
//     "launch": { "run": ["node", "src/server.mjs"], "env": { "PORT": "{port}" },
//                 "ready": { "path": "/todos", "status": 200 }, "timeout_ms": 10000 },
//     "scenarios_dir": "test/scenarios", "verifies": "ui", "record_bodies": true }
//
// Scenarios are JSON files in scenarios_dir, which agents may edit: one per
// acceptance criterion is the idea. Each step sends a request and checks the
// status and a subset of the JSON body; `save` keeps a value for later steps as
// {name}. {port} is the port the kit picked.
//
// Each scenario runs against a freshly started application, so scenarios cannot
// depend on each other's data. The process is always stopped, with everything it
// started: taskkill /T on Windows, the process group elsewhere.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { usageError } from '../../core/errors.mjs';
import { headSha, isClean, repoInfo } from '../../core/git.mjs';
import { dataPath } from '../../collector/lib/paths.mjs';
import { resolveProject } from '../../collector/lib/registry.mjs';
import { readWorktreeMarker } from '../../collector/lib/state.mjs';
import { appendEvent, makeEvent } from '../../collector/lib/store.mjs';
import { CHECKS, loadTaskRecords, verifyTask } from '../../collector/lib/tasks.mjs';

export const VERIFY_FILE = path.join('.asdk', 'verify.json');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const BODY_LIMIT = 4096;
const LOG_LINES = 50;
const REQUEST_TIMEOUT_MS = 10000;

const readJson = (file, label) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    throw usageError(`${label} is not valid JSON: ${err.message}`);
  }
};

export function loadVerifyConfig(top) {
  const file = path.join(top, VERIFY_FILE);
  if (!existsSync(file)) throw usageError(`no verification setup at ${VERIFY_FILE}`);
  const c = readJson(file, VERIFY_FILE);
  const fail = (msg) => {
    throw usageError(`${VERIFY_FILE}: ${msg}`);
  };
  const l = c?.launch;
  if (!l || !Array.isArray(l.run) || l.run.length === 0 || !l.run.every((a) => typeof a === 'string')) fail('"launch.run" must be an argv array');
  if (l.env !== undefined && (typeof l.env !== 'object' || !Object.values(l.env).every((v) => typeof v === 'string'))) fail('"launch.env" values must be strings');
  if (typeof l.ready?.path !== 'string' || !l.ready.path.startsWith('/')) fail('"launch.ready.path" must start with /');
  if (l.ready.status !== undefined && !Number.isInteger(l.ready.status)) fail('"launch.ready.status" must be a status code');
  if (l.timeout_ms !== undefined && (!Number.isInteger(l.timeout_ms) || l.timeout_ms < 100)) fail('"launch.timeout_ms" must be at least 100');
  const verifies = c.verifies ?? 'ui';
  if (!CHECKS.includes(verifies) || verifies === 'acceptance' || verifies === 'review') fail(`"verifies" must be one of build, unit, integration, ui`);
  const dir = c.scenarios_dir ?? 'test/scenarios';
  if (path.isAbsolute(dir) || dir.split(/[\\/]/).includes('..')) fail('"scenarios_dir" must be inside the repository');
  return { launch: { timeout_ms: 10000, env: {}, ...l, ready: { status: 200, ...l.ready } }, verifies, scenarios_dir: dir, record_bodies: c.record_bodies !== false };
}

function validateScenario(s, name) {
  const fail = (msg) => {
    throw usageError(`scenario ${name}: ${msg}`);
  };
  if (!s || !Array.isArray(s.steps) || s.steps.length === 0) fail('"steps" must be a non-empty array');
  s.steps.forEach((step, i) => {
    const at = `step ${i + 1}`;
    if (!METHODS.includes(step.request?.method)) fail(`${at}: request.method must be one of ${METHODS.join(', ')}`);
    if (typeof step.request.path !== 'string' || !step.request.path.startsWith('/')) fail(`${at}: request.path must start with /`);
    if (!Number.isInteger(step.expect?.status)) fail(`${at}: expect.status is required`);
    for (const [k, v] of Object.entries(step.save ?? {})) if (!NAME.test(k) || typeof v !== 'string') fail(`${at}: save maps a name to a dotted path in the response`);
  });
  return s;
}

/** Scenario files: { name, file, scenario }, all of them or the one named. */
export function loadScenarios(top, config, only) {
  const dir = path.join(top, config.scenarios_dir);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const picked = only ? files.filter((f) => f === `${only}.json`) : files;
  if (only && picked.length === 0) throw usageError(`no scenario "${only}" in ${config.scenarios_dir}`);
  if (picked.length === 0) throw usageError(`no scenarios in ${config.scenarios_dir}`);
  return picked.map((f) => {
    const name = f.slice(0, -5);
    return { name, file: `${config.scenarios_dir}/${f}`, scenario: validateScenario(readJson(path.join(dir, f), `${config.scenarios_dir}/${f}`), name) };
  });
}

/** Replaces {name} in strings; a string that is only "{name}" takes the saved value's type. */
export function substitute(value, vars) {
  if (typeof value === 'string') {
    const whole = /^\{([A-Za-z0-9_.-]+)\}$/.exec(value);
    if (whole && Object.hasOwn(vars, whole[1])) return vars[whole[1]];
    return value.replace(/\{([A-Za-z0-9_.-]+)\}/g, (m, k) => (Object.hasOwn(vars, k) ? String(vars[k]) : m));
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, vars));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, vars)]));
  return value;
}

/** Where `actual` differs from the `expected` subset: null when it matches. Arrays must match in full. */
export function mismatch(expected, actual, at = '') {
  if (expected === null || typeof expected !== 'object') return Object.is(expected, actual) ? null : `${at || 'body'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return `${at || 'body'}: expected an array of ${expected.length}, got ${Array.isArray(actual) ? `${actual.length}` : JSON.stringify(actual)}`;
    for (let i = 0; i < expected.length; i++) {
      const m = mismatch(expected[i], actual[i], `${at}[${i}]`);
      if (m) return m;
    }
    return null;
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return `${at || 'body'}: expected an object, got ${JSON.stringify(actual)}`;
  for (const [k, v] of Object.entries(expected)) {
    const m = mismatch(v, actual[k], at ? `${at}.${k}` : k);
    if (m) return m;
  }
  return null;
}

const pick = (value, dotted) => dotted.split('.').reduce((v, k) => (v == null ? undefined : v[k]), value);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Stops the process and everything it started; resolves once it has exited. */
async function stopTree(child, exited) {
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
      const done = await Promise.race([exited.then(() => true), sleep(2000).then(() => false)]);
      if (!done) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
  }
  await Promise.race([exited, sleep(5000)]);
}

async function request(base, req) {
  const headers = { ...(req.headers ?? {}) };
  let body;
  if (req.json !== undefined) {
    body = JSON.stringify(req.json);
    headers['content-type'] ??= 'application/json';
  }
  const res = await fetch(`${base}${req.path}`, { method: req.method, headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, contentType: res.headers.get('content-type'), text, json };
}

async function runScenario({ name, file, scenario }, base, port, recordBodies) {
  const vars = { port };
  const steps = [];
  let result = 'pass';
  for (const [i, raw] of scenario.steps.entries()) {
    const stepName = raw.name ?? `step ${i + 1}`;
    if (result !== 'pass') {
      steps.push({ name: stepName, result: 'skipped' });
      continue;
    }
    const req = substitute(raw.request, vars);
    const expect = substitute(raw.expect, vars);
    const entry = { name: stepName, request: { method: req.method, path: req.path, ...(recordBodies && req.json !== undefined ? { json: req.json } : {}) } };
    try {
      const res = await request(base, req);
      entry.response = { status: res.status, content_type: res.contentType, ...(recordBodies ? { body: res.text.slice(0, BODY_LIMIT), ...(res.text.length > BODY_LIMIT ? { body_truncated: true } : {}) } : {}) };
      let why = res.status === expect.status ? null : `status: expected ${expect.status}, got ${res.status}`;
      if (!why && expect.json !== undefined) why = res.json === undefined ? 'body is not JSON' : mismatch(expect.json, res.json);
      if (!why && expect.length !== undefined) why = Array.isArray(res.json) && res.json.length === expect.length ? null : `length: expected ${expect.length}, got ${Array.isArray(res.json) ? res.json.length : 'no array'}`;
      for (const [k, p] of Object.entries(raw.save ?? {})) {
        const v = pick(res.json, p);
        if (v === undefined && !why) why = `save ${k}: nothing at "${p}" in the response`;
        vars[k] = v;
      }
      entry.result = why ? 'fail' : 'pass';
      if (why) entry.reason = why;
    } catch (err) {
      entry.result = 'error';
      entry.reason = err.name === 'TimeoutError' ? `no answer within ${REQUEST_TIMEOUT_MS} ms` : err.message;
    }
    if (entry.result !== 'pass') result = entry.result;
    steps.push(entry);
  }
  return { name, file, ...(scenario.criteria ? { criteria: scenario.criteria } : {}), result, steps };
}

/**
 * Starts the application on a free port, waits until it answers, runs fn(base, port) and stops
 * it with everything it started, whatever happened.
 * @returns {Promise<{ port: number, log: string[], problem?: string, value?: any }>}
 */
async function withApplication(top, env, launch, fn) {
  const port = await freePort();
  const vars = { port };
  const [cmd, ...args] = substitute(launch.run, vars);
  const child = spawn(cmd === 'node' ? process.execPath : cmd, args, {
    cwd: top,
    env: { ...env, ...substitute(launch.env, vars) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', // its own process group, so it can be stopped as a whole
    windowsHide: true,
  });
  const log = [];
  const collect = (chunk) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line) log.push(line);
    if (log.length > LOG_LINES) log.splice(0, log.length - LOG_LINES);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  let spawnError = null;
  const exited = new Promise((resolve) => {
    child.on('exit', resolve);
    child.on('error', (err) => {
      spawnError = err;
      resolve();
    });
  });

  const base = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + launch.timeout_ms;
    let ready = false;
    while (!ready && Date.now() < deadline) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) break;
      try {
        const r = await fetch(`${base}${launch.ready.path}`, { signal: AbortSignal.timeout(1000) });
        await r.arrayBuffer();
        ready = r.status === launch.ready.status;
      } catch {
        // not listening yet
      }
      if (!ready) await sleep(100);
    }
    if (spawnError) return { port, log, problem: `could not start ${cmd}: ${spawnError.message}` };
    if (!ready) {
      const problem = child.exitCode !== null ? `the application exited with code ${child.exitCode} before it was ready` : `not ready within ${launch.timeout_ms} ms (${launch.ready.path} did not answer ${launch.ready.status})`;
      return { port, log, problem };
    }
    return { port, log, value: await fn(base, port) };
  } finally {
    await stopTree(child, exited);
  }
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/**
 * Launches the project in the repository that contains `cwd`, runs its scenarios and stops it.
 * @returns {Promise<{ result: 'pass' | 'fail' | 'error', evidence: object, file: string, sha256: string, recorded: boolean }>}
 */
export async function runVerify(env, { cwd, scenario: only, taskId, record = false, now = () => new Date() }) {
  const repo = repoInfo(cwd, env);
  if (!repo) throw usageError('not inside a git repository');
  const top = repo.toplevel;
  const config = loadVerifyConfig(top);
  const scenarios = loadScenarios(top, config, only);
  const project = resolveProject(top, { env });
  if (!project.project_id) throw usageError('this repository is not a registered project; run "asdk project add"');
  const id = taskId ?? (project.worktree ? readWorktreeMarker(env, project.project_id, project.worktree)?.task_id : undefined);
  const task = id ? loadTaskRecords(env).get(id) : null;
  if (id && !task) throw usageError(`task ${id} has not been started`);
  if (record && !task) throw usageError('--record needs a task: pass --task or run inside a task worktree');
  const head = headSha(top, env);
  if (!head) throw usageError('the repository has no commits yet');
  const treeClean = isClean(top, env);
  // Evidence vouches for a commit: uncommitted changes would make it vouch for something else.
  if (record && !treeClean) throw usageError('commit or discard uncommitted changes first; recorded evidence must match the commit');

  // Each scenario gets a freshly started application, so no scenario sees another's data.
  const startedAt = now();
  const results = [];
  for (const s of scenarios) {
    const app = await withApplication(top, env, config.launch, (base, port) => runScenario(s, base, port, config.record_bodies));
    const named = { name: s.name, file: s.file, ...(s.scenario.criteria ? { criteria: s.scenario.criteria } : {}) };
    results.push(
      app.problem
        ? { ...named, result: 'error', launch_problem: app.problem, steps: [], port: app.port, server_log_tail: app.log }
        : { ...app.value, port: app.port, server_log_tail: app.log },
    );
  }

  const result = results.some((r) => r.result === 'error') ? 'error' : results.some((r) => r.result === 'fail') ? 'fail' : 'pass';
  const finishedAt = now();
  const evidence = {
    schema_version: 1,
    project_id: project.project_id,
    ...(task ? { task_id: task.task_id } : {}),
    head_sha: head,
    tree_clean: treeClean,
    check: config.verifies,
    result,
    scenarios: results,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
  };
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  const sha256 = createHash('sha256').update(text).digest('hex');
  const file = dataPath(env, 'evidence', project.project_id, head, `${only ?? 'all'}-${stamp(finishedAt)}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);

  appendEvent(
    env,
    makeEvent(
      {
        source: 'cli',
        event: 'verify.run',
        project_id: project.project_id,
        project_source: project.project_source,
        task_id: task?.task_id,
        worktree: project.worktree ?? undefined,
        data: { result, head_sha: head, tree_clean: treeClean, scenarios: results.length, evidence: sha256 },
      },
      finishedAt,
    ),
  );
  if (record) verifyTask(env, { taskId: task.task_id, check: config.verifies, result, executor: 'script', sha: head, evidence: sha256, source: 'cli', now: finishedAt });
  return { result, evidence, file, sha256, recorded: record };
}
