import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, makeDemoRepo, runAsdk } from '../../../test/helpers/sandbox.mjs';
import { changePlan } from '../../../collector/lib/quota.mjs';
import { applyToAgents, frontmatter, readField, setField } from '../agents.mjs';

test('frontmatter fields are read and set without touching other bytes', () => {
  const text = '\uFEFF---\r\nname: reviewer\r\nmodel: "sonnet"  \r\ntools: Read\r\n---\r\n\r\nBody: model: not this one.\r\n';
  const f = frontmatter(text);
  assert.equal(readField(f.text, 'name'), 'reviewer');
  assert.equal(readField(f.text, 'model'), 'sonnet');
  assert.equal(readField(f.text, 'effort'), null);
  let next = setField(f.text, 'model', 'opus', f.eol);
  next = setField(next, 'effort', 'high', f.eol);
  assert.equal(
    text.slice(0, f.start) + next + text.slice(f.end),
    '\uFEFF---\r\nname: reviewer\r\nmodel: opus\r\ntools: Read\r\neffort: high\r\n---\r\n\r\nBody: model: not this one.\r\n',
  );
  assert.equal(frontmatter('# no frontmatter\n'), null);
});

test('applyToAgents sets model and effort for roles the profile knows', (t) => {
  const sb = createSandbox(t, 'agents-apply');
  const dir = path.join(sb.join('專案 目錄'), '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'implementer.md'), '---\nname: implementer\nmodel: sonnet\n---\nBody\n');
  writeFileSync(path.join(dir, 'designer.md'), '---\nname: designer\n---\nBody\n');
  writeFileSync(path.join(dir, 'notes.md'), '# not an agent\n');
  const top = sb.join('專案 目錄');
  const settings = (role) => (role === 'implementer' ? { model: 'opus', effort: 'xhigh' } : null);

  const dry = applyToAgents(top, settings, { dryRun: true });
  assert.deepEqual(dry.map((r) => [r.file, r.role, r.changed]), [
    ['.claude/agents/designer.md', 'designer', false],
    ['.claude/agents/implementer.md', 'implementer', true],
    ['.claude/agents/notes.md', null, false],
  ]);
  assert.match(readFileSync(path.join(dir, 'implementer.md'), 'utf8'), /model: sonnet/);

  const [, impl] = applyToAgents(top, settings);
  assert.deepEqual([impl.from, impl.to], [{ model: 'sonnet', effort: null }, { model: 'opus', effort: 'xhigh' }]);
  assert.equal(readFileSync(path.join(dir, 'implementer.md'), 'utf8'), '---\nname: implementer\nmodel: opus\neffort: xhigh\n---\nBody\n');
  assert.equal(applyToAgents(top, settings)[1].changed, false, 'idempotent');
  assert.deepEqual(applyToAgents(sb.join('nowhere'), settings), []);
});

test('asdk profile apply writes the demo implementer from the current plan', (t) => {
  const sb = createSandbox(t, 'agents-cli');
  const repo = makeDemoRepo(sb, sb.join('示範 專案'));
  const file = path.join(repo, '.claude', 'agents', 'implementer.md');
  const before = readFileSync(file, 'utf8');
  changePlan(sb.env, { plan: 'ultra' });

  let r = runAsdk(sb, ['profile', 'apply', '--risk', 'high', '--dry-run'], { cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would set .claude\/agents\/implementer\.md: model sonnet -> opus, effort \(none\) -> xhigh/);
  assert.equal(readFileSync(file, 'utf8'), before);

  r = runAsdk(sb, ['profile', 'apply', '--profile', 'pro'], { cwd: repo });
  assert.match(r.stdout, /set {7}.claude\/agents\/implementer\.md: model sonnet -> sonnet, effort \(none\) -> high/);
  assert.equal(readFileSync(file, 'utf8'), before.replace('model: sonnet\n', 'model: sonnet\neffort: high\n'));
  assert.match(runAsdk(sb, ['profile', 'apply', '--profile', 'pro'], { cwd: repo }).stdout, /ok {8}.claude\/agents\/implementer\.md already sonnet, high/);
  assert.equal(runAsdk(sb, ['profile', 'apply', '--risk', 'severe'], { cwd: repo }).status, 2);
  assert.equal(runAsdk(sb, ['profile', 'apply'], { cwd: sb.home }).status, 2);
});
