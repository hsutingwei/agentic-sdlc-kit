import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, makeRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { changePlan } from '../../collector/lib/quota.mjs';
import { claudeArgs, loadProfiles, resolveRole, selectProfile } from '../profiles/profiles.mjs';

test('the kit profiles follow the roadmap starting points', () => {
  const { profiles, plans } = loadProfiles();
  assert.deepEqual(Object.keys(profiles), ['ultra', 'max', 'pro']);
  assert.equal(plans['max-5x'], 'max');
  const r = (p, role, risk) => {
    const x = resolveRole(profiles[p], role, risk);
    return `${x.model} ${x.effort} ${x.isolation}`;
  };
  assert.equal(r('ultra', 'planner', 'low'), 'opus xhigh fresh');
  assert.equal(r('ultra', 'implementer', 'medium'), 'opus high fresh');
  assert.equal(r('ultra', 'implementer', 'high'), 'opus xhigh fresh');
  assert.equal(r('ultra', 'reviewer', 'high'), 'sonnet high sterile');
  assert.equal(r('max', 'tester', 'low'), 'haiku high sterile');
  assert.equal(r('pro', 'implementer', 'medium'), 'sonnet high fresh');
  assert.equal(r('pro', 'implementer', 'critical'), 'opus high fresh');
  assert.deepEqual(Object.values(profiles.ultra.verifiers), [0, 2, 3, 3]);
  assert.deepEqual(Object.values(profiles.pro.verifiers), [0, 1, 1, 1]);
  assert.deepEqual(claudeArgs(resolveRole(profiles.ultra, 'planner')), ['--model', 'opus', '--effort', 'xhigh']);
  assert.throws(() => resolveRole(profiles.max, 'designer'), /no role "designer"/);
  assert.throws(() => resolveRole(profiles.max, 'tester', 'severe'), /risk must be one of/);
});

test('the profile comes from --profile, --plan or the latest plan change', (t) => {
  const sb = createSandbox(t, 'profile-select');
  const profiles = loadProfiles();
  assert.throws(() => selectProfile(sb.env, profiles), /no plan is known/);
  assert.equal(selectProfile(sb.env, profiles, { profile: 'pro' }).source, 'profile');
  assert.deepEqual(
    (({ name, plan, source }) => ({ name, plan, source }))(selectProfile(sb.env, profiles, { plan: 'max-20x' })),
    { name: 'max', plan: 'max-20x', source: 'plan' },
  );
  changePlan(sb.env, { plan: 'ultra' });
  assert.equal(selectProfile(sb.env, profiles).name, 'ultra');
  changePlan(sb.env, { plan: 'team' });
  assert.throws(() => selectProfile(sb.env, profiles), /plan "team" has no profile/);
  assert.throws(() => selectProfile(sb.env, profiles, { profile: 'enterprise' }), /unknown profile/);
});

test('a project adds plans and replaces whole profiles; mistakes are named', (t) => {
  const sb = createSandbox(t, 'profile-project');
  const top = makeRepo(sb, sb.join('示範 專案'));
  mkdirSync(path.join(top, '.asdk'), { recursive: true });
  const write = (value) => writeFileSync(path.join(top, '.asdk', 'profiles.json'), JSON.stringify(value));
  const lean = {
    tiers: { light: 'haiku', standard: 'sonnet', strong: 'claude-opus-5-5' },
    roles: { implementer: { tier: 'standard', effort: 'medium', isolation: 'fresh' } },
    verifiers: { low: 0, medium: 1, high: 1, critical: 2 },
  };
  write({ plans: { team: 'max' }, profiles: { max: lean } });
  const merged = loadProfiles(top);
  assert.equal(merged.plans.team, 'max');
  assert.deepEqual(Object.keys(merged.profiles.max.roles), ['implementer'], 'replaced, not merged');
  assert.equal(merged.profiles.ultra.roles.planner.effort, 'xhigh', 'other kit profiles stay');

  for (const [value, message] of [
    [{ plans: { team: 'gold' } }, /points at profile "gold"/],
    [{ profiles: { max: { ...lean, tiers: { light: 'haiku' } } } }, /tiers\.standard must be a model/],
    [{ profiles: { max: { ...lean, roles: {} } } }, /at least one role/],
    [{ profiles: { max: { ...lean, roles: { implementer: { tier: 'huge', effort: 'high', isolation: 'fresh' } } } } }, /tier must be one of/],
    [{ profiles: { max: { ...lean, roles: { implementer: { tier: 'strong', effort: 'ultra', isolation: 'fresh' } } } } }, /effort must be one of/],
    [{ profiles: { max: { ...lean, roles: { implementer: { tier: 'strong', effort: 'high', isolation: 'fresh', by_risk: { severe: {} } } } } } }, /"severe" is not a risk level/],
    [{ profiles: { max: { ...lean, roles: { implementer: { tier: 'strong', effort: 'high', isolation: 'fresh', by_risk: { high: { model: 'x' } } } } } } }, /unknown key "model"/],
    [{ profiles: { max: { ...lean, verifiers: { low: 0 } } } }, /verifiers\.medium must be a whole number/],
  ]) {
    write(value);
    assert.throws(() => loadProfiles(top), message, JSON.stringify(value));
  }
});

test('asdk profile show prints the table, JSON or claude flags', (t) => {
  const sb = createSandbox(t, 'profile-cli');
  const top = makeRepo(sb, sb.join('專案'));
  let r = runAsdk(sb, ['profile', 'show'], { cwd: top });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no plan is known/);
  changePlan(sb.env, { plan: 'max-5x' });
  r = runAsdk(sb, ['profile', 'show'], { cwd: top });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^profile max \(plan max-5x, from the latest plan change\)/);
  assert.match(r.stdout, /tester {7}low {7}haiku {5}high {4}sterile/);
  assert.match(r.stdout, /verifiers: low 0, medium 1, high 2, critical 2/);
  r = runAsdk(sb, ['profile', 'show', '--profile', 'ultra', '--role', 'implementer', '--risk', 'high', '--json'], { cwd: top });
  assert.deepEqual(JSON.parse(r.stdout).roles, [{ role: 'implementer', risk: 'high', tier: 'strong', model: 'opus', effort: 'xhigh', isolation: 'fresh' }]);
  r = runAsdk(sb, ['profile', 'show', '--plan', 'pro', '--role', 'tester', '--format', 'claude-args'], { cwd: top });
  assert.equal(r.stdout.trim(), '--model haiku --effort medium');
  assert.equal(runAsdk(sb, ['profile', 'show', '--format', 'claude-args'], { cwd: top }).status, 2);
  assert.equal(runAsdk(sb, ['profile', 'show', '--plan', 'pro', '--profile', 'max'], { cwd: top }).status, 2);
  assert.equal(runAsdk(sb, ['profile', 'list'], { cwd: top }).status, 2);
});
