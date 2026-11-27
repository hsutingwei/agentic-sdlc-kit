// Merge policy: what a task branch needs, by effective risk, before `wt finish`
// merges it into the integration branch. It lives in .asdk/gates.json:
//
//   "merge_policy": {
//     "low":      { "gate": "G1" },
//     "medium":   { "gate": "G2", "reviews": { "any": "profile" } },
//     "high":     { "gate": "G2", "reviews": { "agent": 1, "human": 1 } },
//     "critical": { "gate": "G2", "reviews": { "agent": 1, "human": 1 } }
//   }
//
// reviews counts passing `review` verifications recorded on the exact commit to
// be merged: `agent` and `human` by executor, `any` in total. A count may be
// "profile": the verifiers the task's plan profile sets for that risk, or 1 for a
// task without a profile. A failing review on that commit blocks the merge until
// a human review passes after it.
//
// Whatever the risk, a change that leaves the scope of the task's brief is not
// merged until a person has accepted that exact commit (see gate/scope.mjs).

import { RISKS } from '../../collector/lib/tasks.mjs';

const REVIEW_KINDS = ['any', 'agent', 'human'];
const RULE_KEYS = ['gate', 'reviews'];

/** Throws through `fail` when the policy is malformed. */
export function validateMergePolicy(policy, gates, fail) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) fail('"merge_policy" must be an object');
  for (const key of Object.keys(policy)) if (!RISKS.includes(key)) fail(`merge_policy: "${key}" is not a risk level (${RISKS.join(', ')})`);
  for (const risk of RISKS) {
    const rule = policy[risk];
    if (!rule || typeof rule !== 'object') fail(`merge_policy: no rule for ${risk} risk`);
    for (const key of Object.keys(rule)) if (!RULE_KEYS.includes(key)) fail(`merge_policy.${risk}: unknown key "${key}"`);
    if (!Object.hasOwn(gates, rule.gate ?? '')) fail(`merge_policy.${risk}: "gate" must name a configured gate`);
    if (!gates[rule.gate].verifies) fail(`merge_policy.${risk}: gate ${rule.gate} needs "verifies" so its result is recorded on the task`);
    const reviews = rule.reviews ?? {};
    if (typeof reviews !== 'object' || Array.isArray(reviews)) fail(`merge_policy.${risk}: "reviews" must be an object`);
    for (const [kind, n] of Object.entries(reviews)) {
      if (!REVIEW_KINDS.includes(kind)) fail(`merge_policy.${risk}.reviews: "${kind}" must be one of ${REVIEW_KINDS.join(', ')}`);
      if (n !== 'profile' && (!Number.isInteger(n) || n < 0 || n > 9)) fail(`merge_policy.${risk}.reviews.${kind} must be a whole number from 0 to 9, or "profile"`);
    }
  }
}

export const VERIFIERS_WITHOUT_PROFILE = 1;

/**
 * The rule for one risk level, with review counts filled in and "profile" replaced by
 * `verifiers`; null when the project has no policy.
 */
export function mergeRule(config, risk, verifiers = VERIFIERS_WITHOUT_PROFILE) {
  const rule = config.merge_policy?.[risk];
  if (!rule) return null;
  const reviews = { any: 0, agent: 0, human: 0 };
  let fromProfile = false;
  for (const [kind, n] of Object.entries(rule.reviews ?? {})) {
    reviews[kind] = n === 'profile' ? verifiers : n;
    if (n === 'profile') fromProfile = true;
  }
  return { gate: rule.gate, reviews, from_profile: fromProfile };
}

/**
 * Whether the reviews recorded on `sha` satisfy `need`.
 * @returns {{ ok: boolean, missing: string[], blocked: boolean, passes: number }}
 */
export function reviewStatus(verifications, sha, need) {
  const onCommit = verifications.filter((v) => v.check === 'review' && v.sha === sha);
  const passes = onCommit.filter((v) => v.result === 'pass');
  const by = (executor) => passes.filter((v) => v.executor === executor).length;
  const lastFail = onCommit.findLastIndex((v) => v.result !== 'pass');
  const blocked = lastFail >= 0 && !onCommit.slice(lastFail + 1).some((v) => v.result === 'pass' && v.executor === 'human');

  const shortAgent = Math.max(0, need.agent - by('agent'));
  const shortHuman = Math.max(0, need.human - by('human'));
  // Reviews still owed by agents or humans also count toward the total.
  const shortAny = Math.max(0, need.any - passes.length - shortAgent - shortHuman);
  const missing = [];
  if (shortAgent) missing.push(`${shortAgent} agent review(s)`);
  if (shortHuman) missing.push(`${shortHuman} human review(s)`);
  if (shortAny) missing.push(`${shortAny} review(s) by an agent or a human`);
  return { ok: !blocked && missing.length === 0, missing, blocked, passes: passes.length };
}

/** Whether a person accepted `sha`: their latest review of that commit passed. */
export function humanAccepted(verifications, sha) {
  const mine = verifications.filter((v) => v.check === 'review' && v.sha === sha && v.executor === 'human');
  return mine.length > 0 && mine.at(-1).result === 'pass';
}
