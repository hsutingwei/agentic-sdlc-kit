import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '../core/validate.mjs';
import { createSandbox, runNode } from './helpers/sandbox.mjs';

const DEMO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'demo-api');

test('demo-api passes its own test suite', (t) => {
  const sb = createSandbox(t, 'demo-suite');
  // The default reporter differs between Node versions; ask for TAP explicitly.
  const r = runNode('--test', ['--test-reporter=tap'], { cwd: DEMO, env: sb.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# pass [1-9]/);
  assert.match(r.stdout, /# fail 0/);
});

test('every demo brief is a valid task-brief', () => {
  const dir = path.join(DEMO, 'briefs');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const brief = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    assert.deepEqual(validateContract('task-brief', brief).errors, [], f);
    assert.equal(`${brief.task_id}.json`, f);
  }
});

test('the implementer agent is read-limited to the tools it needs', () => {
  const text = readFileSync(path.join(DEMO, '.claude', 'agents', 'implementer.md'), 'utf8');
  const front = /^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, '\n'))[1];
  assert.match(front, /^name: implementer$/m);
  assert.match(front, /^tools: Read, Edit, Write, Grep, Glob, Bash$/m);
  assert.match(front, /^model: \S+$/m);
});

test('demo-api carries the governance templates, with only the project notes filled in', () => {
  const TEMPLATES = path.join(DEMO, '..', '..', 'governance', 'templates');
  const read = (...p) => readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');
  const shared = (text) => text.slice(0, text.indexOf('## Project notes'));
  assert.equal(shared(read(DEMO, 'AGENTS.md')), shared(read(TEMPLATES, 'AGENTS.md')));
  assert.doesNotMatch(read(DEMO, 'AGENTS.md'), /<!-- Replace with/);
  assert.equal(read(DEMO, 'CLAUDE.md'), '@AGENTS.md\n');
  assert.deepEqual(JSON.parse(read(DEMO, '.claude', 'settings.json')), JSON.parse(read(TEMPLATES, 'settings.json')));
});
