import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, git, makeDemoRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { registerProject } from '../../collector/lib/registry.mjs';
import { runGate } from '../gate/gate.mjs';
import { checkRules, loadRules, testRules } from '../gate/rules.mjs';

function setup(t, label) {
  const sb = createSandbox(t, label);
  const repo = makeDemoRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root: repo });
  return { sb, repo, rulesFile: path.join(repo, '.asdk', 'rules.json') };
}

const commitAll = (sb, repo, message) => {
  git(sb, repo, 'add', '.');
  git(sb, repo, 'commit', '-q', '-m', message);
};

test('the demo rule proves itself on its own mistake', (t) => {
  const { repo } = setup(t, 'rules-demo');
  const rules = loadRules(repo);
  assert.deepEqual(rules.map((r) => r.id), ['utc-dates']);
  assert.deepEqual(testRules(rules), [{ id: 'utc-dates', ok: true, problems: [] }]);
});

test('a rule that misses its mistake or flags good code is reported', (t) => {
  const { repo, rulesFile } = setup(t, 'rules-test');
  const config = JSON.parse(readFileSync(rulesFile, 'utf8'));
  config.rules[0].examples.bad.push('const day = d.getUTCDay();');
  config.rules[0].examples.good.push('const year = d.getFullYear();');
  writeFileSync(rulesFile, JSON.stringify(config));
  const [r] = testRules(loadRules(repo));
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, ['does not catch bad example 3: const day = d.getUTCDay();', 'flags good example 3: const year = d.getFullYear();']);
});

test('findings name the file, line, rule and fix; asdk-allow keeps an exception visible', (t) => {
  const { sb, repo } = setup(t, 'rules-check');
  writeFileSync(
    path.join(repo, 'src', '日期.mjs'),
    [
      'export const today = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}`;',
      'export const label = (d) => d.toLocaleDateString(); // asdk-allow: utc-dates - shown to people, not compared',
      'export const utc = (d) => d.toISOString().slice(0, 10);',
      '',
    ].join('\n'),
  );
  writeFileSync(path.join(repo, 'test', 'unit', 'local.test.mjs'), '// d.getDate() in a test is outside the rule\n');
  commitAll(sb, repo, 'feat: dates');
  const findings = checkRules(loadRules(repo), { cwd: repo, env: sb.env });
  assert.deepEqual(findings.map((f) => [f.file, f.line, f.id]), [['src/日期.mjs', 1, 'utc-dates']]);
  assert.match(findings[0].message, /Compare dates in UTC/);

  const { summary, outputs } = runGate(sb.env, { gate: 'G1', cwd: repo });
  assert.equal(summary.result, 'fail');
  assert.equal(summary.steps.find((s) => s.name === 'rules from mistakes').result, 'fail');
  assert.match(outputs['rules from mistakes'], /^1 finding\(s\):\nsrc\/日期\.mjs:1 {2}\[utc-dates\] Compare dates in UTC/);

  const out = runAsdk(sb, ['rules', 'check'], { cwd: repo });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /1 rule\(s\), 1 finding\(s\)/);
  assert.equal(runAsdk(sb, ['rules', 'test'], { cwd: repo }).status, 0);
});

test('rules files are checked when loaded; a project without one passes', (t) => {
  const { sb, repo, rulesFile } = setup(t, 'rules-load');
  const base = JSON.parse(readFileSync(rulesFile, 'utf8')).rules[0];
  for (const [rules, message] of [
    [[{ ...base, id: 'UTC' }], /"id" must be lowercase/],
    [[base, base], /duplicate id/],
    [[{ ...base, files: [] }], /"files" must be a non-empty list/],
    [[{ ...base, pattern: '(' }], /not a valid regular expression/],
    [[{ ...base, flags: 'g' }], /may only contain i and u/],
    [[{ ...base, message: 'bad' }], /must say how to fix it/],
    [[{ ...base, origin: '' }], /must say where the mistake was made/],
    [[{ ...base, examples: { bad: [], good: ['x'] } }], /must show the mistake/],
    [[{ ...base, examples: { bad: 'd.getDate()' } }], /must show code the rule leaves alone/],
  ]) {
    writeFileSync(rulesFile, JSON.stringify({ schema_version: 1, rules }));
    assert.throws(() => loadRules(repo), message);
  }
  git(sb, repo, 'rm', '-q', '-f', '.asdk/rules.json');
  commitAll(sb, repo, 'chore: no rules');
  assert.match(runAsdk(sb, ['rules', 'test'], { cwd: repo }).stdout, /no rules in/);
  const g1 = runGate(sb.env, { gate: 'G1', cwd: repo });
  assert.equal(g1.summary.result, 'pass');
  assert.match(g1.outputs['rules from mistakes'], /nothing to check/);
});
