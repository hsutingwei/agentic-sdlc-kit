// The E1 command line from init to analysis, with the scripted agent and typed answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createSandbox } from './helpers/sandbox.mjs';
import { main } from '../tools/experiment/e1.mjs';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');

test('init, pilot run, blind review, status and analysis', async (t) => {
  const sb = createSandbox(t, 'e1-cli');
  const dir = sb.join('實驗 E1');
  const lines = [];
  const out = (l) => lines.push(l);
  const baseEnv = { ...sb.env, FAKE_CLAUDE_MODE: 'solve' };
  const e1 = (args, extra = {}) => main(args, { out, baseEnv, output: new PassThrough(), ...extra });

  assert.equal(await e1(['init', dir, '--seed', '11']), 0);
  assert.match(lines.at(-1), /planned 42 runs .* the first 3 are the pilot \(DEMO-102\)/);
  await assert.rejects(e1(['init', dir]), /never replaced/);

  assert.equal(await e1(['run', dir, '--pilot', '--claude', FAKE]), 0);
  assert.equal(lines.filter((l) => /^r0[123] DEMO-102: gate passed, 1 attempt\(s\)/.test(l)).length, 3);
  await e1(['status', dir]);
  assert.match(lines.at(-2), /42 planned: review 3, planned 39/);
  assert.match(lines.at(-1), /last quota seen: five_hour 42%, seven_day 10%/);

  // Start, accept, a note that must stay local; three times.
  const input = new PassThrough();
  input.end(['', 'a', 'private note 不公開', '', 'a', '', '', 'r', ''].join('\n') + '\n');
  assert.equal(await e1(['review', dir], { input }), 0);
  const shown = lines.join('\n');
  assert.match(shown, /=== Review 1 of 3 \(the profile is not shown\) ===/);
  assert.doesNotMatch(shown.split('=== Review 1')[1], /ultra|\bmax\b|\bpro\b/);
  assert.match(shown, /accepted after [\d.]+ min; hidden tests pass/);
  assert.match(shown, /rejected after [\d.]+ min/);
  assert.match(lines.at(-1), /0 review\(s\) left/);

  assert.equal(await e1(['analyze', dir]), 0);
  const runsCsv = readFileSync(path.join(dir, 'analysis', 'runs.csv'), 'utf8');
  assert.equal(runsCsv.trim().split('\r\n').length, 4);
  assert.doesNotMatch(runsCsv, /private note|不公開/);
  const profiles = readFileSync(path.join(dir, 'analysis', 'profiles.csv'), 'utf8').trim().split('\r\n');
  assert.equal(profiles.length, 4);
  assert.ok(profiles[0].startsWith('profile,runs,accepted,first_pass_rate'), profiles[0]); // trim() also drops the BOM
  const summary = readFileSync(path.join(dir, 'analysis', 'summary.md'), 'utf8');
  assert.match(summary, /Runs finished: 3 of 42 planned \(seed 11\)/);
  assert.match(summary, /\| DEMO-102 \| medium \|/);
});
