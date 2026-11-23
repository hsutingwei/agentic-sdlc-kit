import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox, runNode } from '../../test/helpers/sandbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'validate-cli.mjs');
const event = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'event.valid.json'), 'utf8'));

function setup(t) {
  const sb = createSandbox(t, 'validate');
  const dir = sb.join('報告 輸出');
  mkdirSync(dir);
  const write = (name, text) => {
    const file = path.join(dir, name);
    writeFileSync(file, text);
    return file;
  };
  return { sb, write };
}

test('a valid file in a CJK directory exits 0', (t) => {
  const { sb, write } = setup(t);
  const file = write('事件.json', JSON.stringify(event));
  const r = runNode(CLI, ['event', file], { env: sb.env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /valid: .*事件\.json \(1 document, event\)/);
});

test('an invalid file exits 1 and names the failing path', (t) => {
  const { sb, write } = setup(t);
  const file = write('bad.json', JSON.stringify({ ...event, source: 'mystery' }));
  const r = runNode(CLI, ['event', file], { env: sb.env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /bad\.json: \/source must be one of/);
});

test('JSONL errors carry line numbers; blank lines and a BOM are ignored', (t) => {
  const { sb, write } = setup(t);
  const lines = ['﻿' + JSON.stringify(event), '', JSON.stringify({ ...event, ts: 'yesterday' }), '{not json'];
  const file = write('events.jsonl', lines.join('\r\n'));
  const r = runNode(CLI, ['event', file, '--jsonl'], { env: sb.env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /events\.jsonl:3: \/ts must be a valid date-time/);
  assert.match(r.stderr, /events\.jsonl:4: not valid JSON/);
  assert.doesNotMatch(r.stderr, /events\.jsonl:1:/);
});

test('usage, missing files and unknown contracts exit 2', (t) => {
  const { sb, write } = setup(t);
  const file = write('x.json', '{}');
  assert.equal(runNode(CLI, [], { env: sb.env }).status, 2);
  assert.equal(runNode(CLI, ['event'], { env: sb.env }).status, 2);
  assert.equal(runNode(CLI, ['event', sb.join('missing.json')], { env: sb.env }).status, 2);
  const unknown = runNode(CLI, ['nope', file], { env: sb.env });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown contract/);
});

test('--list prints the contract names', (t) => {
  const { sb } = setup(t);
  const r = runNode(CLI, ['--list'], { env: sb.env });
  assert.equal(r.status, 0);
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), ['agent-report', 'event', 'gate-summary', 'task', 'task-brief']);
});
