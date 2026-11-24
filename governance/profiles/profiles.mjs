// Profiles: which model, reasoning effort and isolation each agent role gets, and
// how many independent verifiers a task needs, for a subscription plan and a risk.
//
// The kit's defaults are in profiles.json next to this file. A project can add
// plans and profiles in .asdk/profiles.json; a profile it defines replaces the
// kit's profile of the same name as a whole, so what applies is easy to read.
//
// Roles map to an abstract tier (light, standard, strong, as in task briefs), and
// each profile maps tiers to concrete models. `by_risk` overrides tier, effort or
// isolation for a risk level.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usageError } from '../../core/errors.mjs';
import { quotaState } from '../../collector/lib/quota.mjs';
import { RISKS } from '../../collector/lib/tasks.mjs';

export const KIT_PROFILES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'profiles.json');
export const PROJECT_PROFILES = path.join('.asdk', 'profiles.json');
export const TIERS = ['light', 'standard', 'strong'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
export const ISOLATIONS = ['fresh', 'sterile'];
const NAME = /^[a-z][a-z0-9-]*$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const OVERRIDABLE = ['tier', 'effort', 'isolation'];

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    throw usageError(`${label} is not valid JSON: ${err.message}`);
  }
}

function validate(config, label) {
  const fail = (msg) => {
    throw usageError(`${label}: ${msg}`);
  };
  if (!config || typeof config !== 'object') fail('must be an object');
  for (const [plan, profile] of Object.entries(config.plans ?? {})) {
    if (!NAME.test(plan)) fail(`plan "${plan}" must be lowercase letters, digits and -`);
    if (typeof profile !== 'string' || !NAME.test(profile)) fail(`plans.${plan} must name a profile`);
  }
  for (const [name, p] of Object.entries(config.profiles ?? {})) {
    const at = `profiles.${name}`;
    if (!NAME.test(name)) fail(`profile "${name}" must be lowercase letters, digits and -`);
    if (!p || typeof p !== 'object') fail(`${at} must be an object`);
    for (const tier of TIERS) if (typeof p.tiers?.[tier] !== 'string' || !MODEL.test(p.tiers[tier])) fail(`${at}.tiers.${tier} must be a model name or alias`);
    if (!p.roles || typeof p.roles !== 'object' || Object.keys(p.roles).length === 0) fail(`${at}.roles must define at least one role`);
    for (const [role, r] of Object.entries(p.roles)) {
      if (!NAME.test(role)) fail(`${at}: role "${role}" must be lowercase letters, digits and -`);
      const check = (o, where, partial) => {
        for (const key of Object.keys(o)) if (![...OVERRIDABLE, ...(partial ? [] : ['by_risk'])].includes(key)) fail(`${where}: unknown key "${key}"`);
        if ((!partial || o.tier !== undefined) && !TIERS.includes(o.tier)) fail(`${where}.tier must be one of ${TIERS.join(', ')}`);
        if ((!partial || o.effort !== undefined) && !EFFORTS.includes(o.effort)) fail(`${where}.effort must be one of ${EFFORTS.join(', ')}`);
        if ((!partial || o.isolation !== undefined) && !ISOLATIONS.includes(o.isolation)) fail(`${where}.isolation must be one of ${ISOLATIONS.join(', ')}`);
      };
      check(r, `${at}.roles.${role}`, false);
      for (const [risk, o] of Object.entries(r.by_risk ?? {})) {
        if (!RISKS.includes(risk)) fail(`${at}.roles.${role}.by_risk: "${risk}" is not a risk level`);
        check(o, `${at}.roles.${role}.by_risk.${risk}`, true);
      }
    }
    for (const risk of RISKS) {
      const n = p.verifiers?.[risk];
      if (!Number.isInteger(n) || n < 0 || n > 9) fail(`${at}.verifiers.${risk} must be a whole number from 0 to 9`);
    }
  }
}

/** The kit's profiles, with the project's additions when `top` has a .asdk/profiles.json. */
export function loadProfiles(top) {
  const kit = readJson(KIT_PROFILES, 'governance/profiles/profiles.json');
  validate(kit, 'governance/profiles/profiles.json');
  const merged = { plans: { ...kit.plans }, profiles: { ...kit.profiles } };
  const file = top ? path.join(top, PROJECT_PROFILES) : null;
  if (file && existsSync(file)) {
    const project = readJson(file, PROJECT_PROFILES);
    validate(project, PROJECT_PROFILES);
    Object.assign(merged.plans, project.plans ?? {});
    Object.assign(merged.profiles, project.profiles ?? {});
  }
  for (const [plan, profile] of Object.entries(merged.plans)) {
    if (!Object.hasOwn(merged.profiles, profile)) throw usageError(`plan "${plan}" points at profile "${profile}", which does not exist`);
  }
  return merged;
}

/**
 * Picks the profile: an explicit one, else the one for an explicit plan, else the one for
 * the plan of the latest `asdk quota plan-change`.
 * @returns {{ name: string, profile: object, plan: string | null, source: 'profile' | 'plan' | 'plan-change' }}
 */
export function selectProfile(env, profiles, { profile, plan } = {}) {
  if (profile !== undefined) {
    if (!Object.hasOwn(profiles.profiles, profile)) throw usageError(`unknown profile "${profile}" (known: ${Object.keys(profiles.profiles).join(', ')})`);
    return { name: profile, profile: profiles.profiles[profile], plan: plan ?? null, source: 'profile' };
  }
  let source = 'plan';
  let name = plan;
  if (name === undefined) {
    name = quotaState(env).plan?.plan;
    source = 'plan-change';
    if (!name) throw usageError('no plan is known: pass --plan or --profile, or record one with "asdk quota plan-change <plan>"');
  }
  const mapped = profiles.plans[name];
  if (!mapped) throw usageError(`plan "${name}" has no profile; map it in "plans" of ${PROJECT_PROFILES} (known plans: ${Object.keys(profiles.plans).join(', ')})`);
  return { name: mapped, profile: profiles.profiles[mapped], plan: name, source };
}

/** What one role gets at one risk level in a profile. */
export function resolveRole(profile, role, risk = 'low') {
  if (!RISKS.includes(risk)) throw usageError(`risk must be one of ${RISKS.join(', ')}`);
  const base = profile.roles[role];
  if (!base) throw usageError(`the profile has no role "${role}" (roles: ${Object.keys(profile.roles).join(', ')})`);
  const { tier, effort, isolation } = { ...base, ...(base.by_risk?.[risk] ?? {}) };
  return { role, risk, tier, model: profile.tiers[tier], effort, isolation };
}

/** Command-line flags for a headless Claude Code run with these settings. */
export const claudeArgs = (resolved) => ['--model', resolved.model, '--effort', resolved.effort];
