import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSchema, listContracts, loadSchema, validateContract } from '../validate.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => JSON.parse(readFileSync(path.join(FIXTURES, `${name}.valid.json`), 'utf8'));
const errorPaths = (name, value) => validateContract(name, value).errors.map((e) => e.path);

const EXPECTED = ['agent-report', 'event', 'gate-summary', 'task', 'task-brief'];

test('the five contracts are shipped', () => {
  assert.deepEqual(listContracts(), EXPECTED);
});

for (const name of EXPECTED) {
  test(`${name}: schema compiles, is identified, and its fixture is valid`, () => {
    const schema = loadSchema(name);
    compileSchema(schema);
    assert.equal(schema.$id, `urn:agentic-sdlc-kit:schema:${name}:1`);
    assert.ok(schema.title && schema.description);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(validateContract(name, fixture(name)).errors, []);
  });

  test(`${name}: unknown top-level fields and a wrong schema_version are rejected`, () => {
    assert.deepEqual(errorPaths(name, { ...fixture(name), surprise: 1 }), ['/surprise']);
    assert.deepEqual(errorPaths(name, { ...fixture(name), schema_version: 2 }), ['/schema_version']);
  });
}

test('shared $defs are identical wherever they appear', () => {
  const seen = new Map();
  for (const name of EXPECTED) {
    for (const [def, body] of Object.entries(loadSchema(name).$defs ?? {})) {
      if (seen.has(def)) assert.deepEqual(body, seen.get(def).body, `$defs/${def} differs between ${seen.get(def).name} and ${name}`);
      else seen.set(def, { name, body });
    }
  }
});

test('unknown contract names are refused, including path tricks', () => {
  assert.throws(() => loadSchema('../package'), /unknown contract/);
  assert.throws(() => loadSchema('nope'), /unknown contract/);
});

test('task: ids, ended tasks and accepted tasks', () => {
  const t = fixture('task');
  assert.deepEqual(errorPaths('task', { ...t, task_id: 'demo-1' }), ['/task_id']);
  assert.deepEqual(errorPaths('task', { ...t, project_id: 'Demo API' }), ['/project_id']);
  const { outcome, completed_by, ...ended } = t;
  assert.deepEqual(errorPaths('task', ended), ['/outcome']);
  const { completed_by: _, ...accepted } = t;
  assert.deepEqual(errorPaths('task', accepted), ['/completed_by']);
  assert.deepEqual(errorPaths('task', { ...t, estimate_hours: 0 }), ['/estimate_hours']);
  assert.deepEqual(errorPaths('task', { ...t, fixes: ['DEMO-000', 'DEMO-000'] }), ['/fixes']);
  assert.deepEqual(errorPaths('task', { ...t, worktree: 'C:\\work\\demo-api' }), ['/worktree']);
});

test('task-brief: scope paths must stay inside the repository', () => {
  const b = fixture('task-brief');
  const withPaths = (allowed) => errorPaths('task-brief', { ...b, scope: { allowed_paths: allowed } });
  assert.deepEqual(withPaths(['src/**', 'a..b/c', '..hidden/x', 'src\\win\\path.js']), []);
  assert.deepEqual(withPaths(['/etc/passwd']), ['/scope/allowed_paths/0']);
  assert.deepEqual(withPaths(['C:/work/demo-api']), ['/scope/allowed_paths/0']);
  assert.deepEqual(withPaths(['\\\\server\\share']), ['/scope/allowed_paths/0']);
  assert.deepEqual(withPaths(['../other-repo']), ['/scope/allowed_paths/0']);
  assert.deepEqual(withPaths(['src/../../x']), ['/scope/allowed_paths/0']);
  assert.deepEqual(withPaths(['src\\..\\x']), ['/scope/allowed_paths/0']);
  assert.deepEqual(withPaths(['..']), ['/scope/allowed_paths/0']);
  assert.deepEqual(withPaths([]), ['/scope/allowed_paths']);
});

test('task-brief: at least one acceptance criterion with an AC id', () => {
  const b = fixture('task-brief');
  assert.deepEqual(errorPaths('task-brief', { ...b, acceptance_criteria: [] }), ['/acceptance_criteria']);
  assert.deepEqual(errorPaths('task-brief', { ...b, acceptance_criteria: [{ id: '1', text: 'x' }] }), ['/acceptance_criteria/0/id']);
  assert.deepEqual(errorPaths('task-brief', { ...b, assignment: { role: 'implementer', model_tier: 'opus' } }), ['/assignment/model_tier']);
});

test('agent-report: a completed report must name its commit and files', () => {
  const r = fixture('agent-report');
  const { head_sha, changed_files, ...bare } = r;
  assert.deepEqual(errorPaths('agent-report', bare), ['/head_sha', '/changed_files']);
  assert.deepEqual(errorPaths('agent-report', { ...bare, status: 'blocked' }), []);
  assert.deepEqual(errorPaths('agent-report', { ...r, head_sha: 'abc123' }), ['/head_sha']);
  assert.deepEqual(errorPaths('agent-report', { ...r, checks: [{ check: 'acceptance', result: 'pass' }] }), ['/checks/0/check']);
});

test('gate-summary: gate and runner names are configurable, steps are required', () => {
  const g = fixture('gate-summary');
  assert.deepEqual(errorPaths('gate-summary', { ...g, gate: 'release-gate.v2', runner: { id: 'ci_windows' } }), []);
  assert.deepEqual(errorPaths('gate-summary', { ...g, gate: 'G 2' }), ['/gate']);
  assert.deepEqual(errorPaths('gate-summary', { ...g, steps: [] }), ['/steps']);
  assert.deepEqual(errorPaths('gate-summary', { ...g, steps: [{ ...g.steps[0], duration_ms: 1.5 }] }), ['/steps/0/duration_ms']);
});

test('event: data holds only short scalar metadata', () => {
  const e = fixture('event');
  assert.deepEqual(errorPaths('event', { ...e, project_id: null, project_source: 'none' }), []);
  assert.deepEqual(errorPaths('event', { ...e, data: { prompt: 'x'.repeat(257) } }), ['/data/prompt']);
  assert.deepEqual(errorPaths('event', { ...e, data: { input: { file_path: 'a', content: 'b' } } }), ['/data/input']);
  assert.deepEqual(errorPaths('event', { ...e, data: { files: ['a'] } }), ['/data/files']);
  const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, i]));
  assert.deepEqual(errorPaths('event', { ...e, data: many }), ['/data']);
  assert.deepEqual(errorPaths('event', { ...e, ts: '2026-11-02T01:15:03' }), ['/ts']);
});
