import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, makeRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { configPath, registerProject } from '../lib/registry.mjs';
import { dataPath } from '../lib/paths.mjs';
import { disableRecording } from '../lib/recording.mjs';
import { runChecks } from '../cli/health.mjs';

const byName = (checks) => Object.fromEntries(checks.map((c) => [c.name, c]));

test('a fresh machine: nothing is broken, but nothing is set up either', (t) => {
  const sb = createSandbox(t, 'health-fresh');
  const c = byName(runChecks(sb.env));
  assert.equal(c.node.status, 'ok');
  assert.equal(c['data directory'].status, 'ok');
  assert.equal(c.projects.status, 'warn');
  assert.equal(c.recording.status, 'ok');
  assert.equal(c['hooks (user)'].status, 'warn');
  assert.equal(c['last hook event'].status, 'warn');
  assert.equal(c['hook probe'].status === 'ok' || c['hook probe'].status === 'warn', true, c['hook probe'].detail);
  assert.equal(runChecks(sb.env).some((x) => x.status === 'fail'), false);
});

test('a working setup is all ok, and problems are named', (t) => {
  const sb = createSandbox(t, 'health-setup');
  const root = makeRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root });
  assert.equal(runAsdk(sb, ['hooks', 'install']).status, 0);
  assert.equal(runAsdk(sb, ['hook'], { input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's', cwd: root }) }).status, 0);

  let c = byName(runChecks(sb.env));
  for (const name of ['projects', 'recording', 'hooks (user)', 'hook errors', 'last hook event']) assert.equal(c[name].status, 'ok', `${name}: ${c[name].detail}`);
  assert.match(c['last hook event'].detail, /SessionStart/);

  disableRecording(sb.env, { reason: 'demo' });
  const now = Date.now();
  appendFileSync(dataPath(sb.env, 'collector-errors.log'), `${new Date(now - 60000).toISOString()} hook: payload is not valid JSON (3 chars)\n`);
  appendFileSync(dataPath(sb.env, 'events', new Date().toISOString().slice(0, 7), 's.jsonl'), 'not json\n');
  c = byName(runChecks(sb.env, { now }));
  assert.equal(c.recording.status, 'warn');
  assert.match(c['hook errors'].detail, /1 in the last 24 hours; last: hook: payload is not valid JSON/);
  assert.equal(c['event lines'].status, 'warn');
});

test('fails are reported with exit status 1', (t) => {
  const sb = createSandbox(t, 'health-fail');
  mkdirSync(path.dirname(configPath(sb.env)), { recursive: true });
  writeFileSync(configPath(sb.env), '{ broken');
  const settings = path.join(sb.home, '.claude', 'settings.json');
  mkdirSync(path.dirname(settings), { recursive: true });
  writeFileSync(settings, '{ "hooks": { "Stop": [] }, // comment\n }');

  const r = runAsdk(sb, ['health']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^fail projects: .*not valid JSON/m);
  assert.match(r.stdout, /^fail hooks \(user\): .*not strict JSON/m);
  const json = JSON.parse(runAsdk(sb, ['health', '--json']).stdout);
  assert.ok(json.every((c) => ['ok', 'warn', 'fail'].includes(c.status)));
  assert.equal(runAsdk(sb, ['health', '--scope', 'local'], { cwd: sb.home }).status, 1);
});

test('settings that override plan profiles are named', (t) => {
  const sb = createSandbox(t, 'health-overrides');
  assert.equal(byName(runChecks(sb.env))['profile overrides'].status, 'ok');
  const c = byName(runChecks({ ...sb.env, CLAUDE_CODE_EFFORT_LEVEL: 'low', CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }))['profile overrides'];
  assert.equal(c.status, 'warn');
  assert.match(c.detail, /CLAUDE_CODE_EFFORT_LEVEL=low sets the reasoning effort/);
  assert.match(c.detail, /CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1 forces one model/);
});
