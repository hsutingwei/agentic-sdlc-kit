import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, git, makeDemoRepo } from '../../test/helpers/sandbox.mjs';
import { registerProject } from '../../collector/lib/registry.mjs';
import { denySyncCheck, referencedPaths, referencesCheck } from '../gate/checks.mjs';
import { runGate } from '../gate/gate.mjs';

function setup(t, label) {
  const sb = createSandbox(t, label);
  const repo = makeDemoRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root: repo });
  return { sb, repo, ctx: { cwd: repo, env: sb.env } };
}

const commitAll = (sb, repo, message) => {
  git(sb, repo, 'add', '.');
  git(sb, repo, 'commit', '-q', '-m', message);
};

test('referencedPaths finds imports and backticked paths, not commands or placeholders', () => {
  const text = [
    '@AGENTS.md and @docs/規則 說明.md',
    'Read `src/server.mjs`, `package.json` and `test/unit/`.',
    'Not paths: `npm test`, `node:http`, `.env`, `briefs/<TASK-ID>.json`, `src/**`, `Bash(git push *)`, `scope.allowed_paths`, `${CLAUDE_SKILL_DIR}/x.sh`.',
    'Mail me at dev@example.invalid, or see `@AGENTS.md` in backticks.',
    '```',
    '`inside/a/fence.mjs` @ignored.md',
    '```',
  ].join('\n');
  assert.deepEqual(referencedPaths(text), [
    { line: 1, path: 'AGENTS.md', kind: 'import' },
    { line: 1, path: 'docs/規則', kind: 'import' },
    { line: 2, path: 'src/server.mjs', kind: 'path' },
    { line: 2, path: 'package.json', kind: 'path' },
    { line: 2, path: 'test/unit/', kind: 'path' },
  ]);
});

test('references passes on the demo and names each missing file with its line', (t) => {
  const { sb, repo, ctx } = setup(t, 'refs');
  const ok = referencesCheck(ctx);
  assert.equal(ok.status, 0, ok.output);
  assert.match(ok.output, /references in \d+ file\(s\) OK/);

  // The sub-agent still points at a file that was renamed.
  const agent = path.join(repo, '.claude', 'agents', 'implementer.md');
  writeFileSync(agent, `${readFileSync(agent, 'utf8')}\nAlso read \`src/store.mjs\` first.\n`);
  mkdirSync(path.join(repo, 'docs'));
  writeFileSync(path.join(repo, 'docs', 'CLAUDE.md'), '@規則.md\n');
  commitAll(sb, repo, 'docs: stale references');
  const bad = referencesCheck(ctx);
  assert.equal(bad.status, 1);
  assert.match(bad.output, /^2 reference\(s\) to missing files/);
  assert.match(bad.output, /\.claude\/agents\/implementer\.md:\d+ {2}src\/store\.mjs does not exist/);
  assert.match(bad.output, /docs\/CLAUDE\.md:1 {2}@規則\.md does not exist/);

  // Imports resolve from the file that holds them.
  writeFileSync(path.join(repo, 'docs', '規則.md'), '# 規則\n');
  writeFileSync(agent, readFileSync(agent, 'utf8').replace('src/store.mjs', 'src/todos.mjs'));
  commitAll(sb, repo, 'docs: fix references');
  assert.equal(referencesCheck(ctx).status, 0);
});

test('deny-sync requires nested settings to repeat the root deny rules', (t) => {
  const { sb, repo, ctx } = setup(t, 'deny');
  assert.match(denySyncCheck(ctx).output, /0 nested settings file\(s\) in sync/);

  const nested = path.join(repo, 'packages', '子 專案', '.claude');
  mkdirSync(nested, { recursive: true });
  const root = JSON.parse(readFileSync(path.join(repo, '.claude', 'settings.json'), 'utf8'));
  writeFileSync(path.join(nested, 'settings.json'), JSON.stringify({ permissions: { deny: root.permissions.deny.slice(2) } }));
  commitAll(sb, repo, 'chore: nested settings');
  const bad = denySyncCheck(ctx);
  assert.equal(bad.status, 1);
  assert.match(bad.output, /packages\/子 專案\/\.claude\/settings\.json lacks 2 root deny rule\(s\): Bash\(git push \*\), Bash\(git reset --hard \*\)/);

  writeFileSync(path.join(nested, 'settings.json'), `\uFEFF${JSON.stringify({ permissions: { deny: [...root.permissions.deny, 'Bash(curl *)'] } })}`);
  commitAll(sb, repo, 'chore: sync nested settings');
  assert.equal(denySyncCheck(ctx).status, 0);

  writeFileSync(path.join(nested, 'settings.json'), '{ not json');
  commitAll(sb, repo, 'chore: break nested settings');
  assert.equal(denySyncCheck(ctx).status, 1);
});

test('G2 runs both checks on the demo', (t) => {
  const { sb, repo } = setup(t, 'refs-gate');
  writeFileSync(path.join(repo, 'AGENTS.md'), `${readFileSync(path.join(repo, 'AGENTS.md'), 'utf8')}- See \`docs/missing.md\`.\n`);
  commitAll(sb, repo, 'docs: stale reference');
  const { summary, outputs } = runGate(sb.env, { gate: 'G2', cwd: repo });
  assert.equal(summary.result, 'fail');
  assert.equal(summary.steps.find((s) => s.name === 'agent references').result, 'fail');
  assert.match(outputs['agent references'], /AGENTS\.md:\d+ {2}docs\/missing\.md does not exist/);
});
