// Stands in for a sterile `claude -p --output-format json` reviewer in the tests: reads
// the packet in its working folder and answers with a scripted verdict.
//
// FAKE_REVIEW_MODE:
//   accept        every criterion met, no findings
//   prove         concerns; F1 act_on fails (proven), F2 act_on passes (not reproduced)
//   accept-proven accept, but with an act_on finding whose test fails
//   refused       concerns; F1 act_on imports node:fs (refused)
//   fenced        accept, wrapped in a ```json fence with text around it
//   garbage       no JSON at all
//   missing-ac    leaves out the last criterion
//   error         the run ends with is_error
// FAKE_REVIEW_ARGS_FILE: append the arguments and the packet's file list, one JSON line per run.

import { appendFileSync, readdirSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.FAKE_REVIEW_MODE ?? 'accept';
const brief = JSON.parse(readFileSync('brief.json', 'utf8'));
if (process.env.FAKE_REVIEW_ARGS_FILE) {
  appendFileSync(process.env.FAKE_REVIEW_ARGS_FILE, `${JSON.stringify({ args, files: readdirSync('.').sort(), diff: readFileSync('change.diff', 'utf8').length, env_effort: process.env.CLAUDE_CODE_EFFORT_LEVEL ?? null })}\n`);
}

const head = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createStore } from '../../src/todos.mjs';\n";
const failing = `${head}test('an empty store lists nothing', () => { assert.equal(createStore().list().length, 99); });\n`;
const passing = `${head}test('an empty store lists nothing', () => { assert.equal(createStore().list().length, 0); });\n`;
const criteria = brief.acceptance_criteria.map((c) => ({ id: c.id, result: 'met' }));

const verdicts = {
  accept: { decision: 'accept', summary: 'Every criterion is met.', criteria, findings: [] },
  prove: {
    decision: 'concerns',
    summary: 'One finding is real, one is not.',
    criteria: criteria.map((c, i) => (i === 0 ? { ...c, result: 'not_met', note: 'see F1' } : c)),
    findings: [
      { id: 'F1', class: 'act_on', title: 'The list is wrong', file: 'src/todos.mjs', line: 20, reproduction: { test: failing } },
      { id: 'F2', class: 'act_on', title: 'A suspected problem that is not there', reproduction: { test: passing } },
      { id: 'F3', class: 'noted', title: 'A test does not clean up' },
    ],
    read_first: ['src/todos.mjs'],
  },
  'accept-proven': { decision: 'accept', summary: 'Looks fine.', criteria, findings: [{ id: 'F1', class: 'act_on', title: 'Missed while accepting', reproduction: { test: failing } }] },
  refused: {
    decision: 'concerns',
    summary: 'A finding whose test reaches for the file system.',
    criteria,
    findings: [{ id: 'F1', class: 'act_on', title: 'Reads a file', reproduction: { test: "import { readFileSync } from 'node:fs';\nreadFileSync('x');\n" } }],
  },
};

let text;
if (mode === 'garbage') text = 'I looked at it and it seems fine.';
else if (mode === 'missing-ac') text = JSON.stringify({ schema_version: 1, ...verdicts.accept, criteria: criteria.slice(0, -1) });
else if (mode === 'fenced') text = `Here is my verdict:\n\`\`\`json\n${JSON.stringify({ schema_version: 1, ...verdicts.accept }, null, 2)}\n\`\`\`\nDone.`;
else text = JSON.stringify({ schema_version: 1, ...(verdicts[mode] ?? verdicts.accept) });

const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'unknown';
const result = {
  type: 'result',
  subtype: mode === 'error' ? 'error_during_execution' : 'success',
  is_error: mode === 'error',
  result: mode === 'error' ? undefined : text,
  total_cost_usd: 0.02,
  num_turns: 3,
  duration_ms: 1500,
  modelUsage: { [`claude-${model}-test`]: { inputTokens: 12, outputTokens: 300, cacheReadInputTokens: 4000, cacheCreationInputTokens: 600 } },
};
process.stdout.write(`${JSON.stringify(result)}\n`);
