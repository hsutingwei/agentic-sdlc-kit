import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRule, reviewStatus, validateMergePolicy } from '../gate/policy.mjs';

const GATES = { G1: { verifies: 'unit', steps: [] }, G2: { verifies: 'integration', steps: [] }, G3: { steps: [] } };
const POLICY = {
  low: { gate: 'G1' },
  medium: { gate: 'G2', reviews: { any: 1 } },
  high: { gate: 'G2', reviews: { agent: 1, human: 1 } },
  critical: { gate: 'G2', reviews: { agent: 2, human: 1 } },
};
const fail = (msg) => {
  throw new Error(msg);
};

test('a merge policy must cover every risk level with known gates and review counts', () => {
  validateMergePolicy(POLICY, GATES, fail);
  const without = (risk) => Object.fromEntries(Object.entries(POLICY).filter(([k]) => k !== risk));
  for (const [policy, message] of [
    [[], /must be an object/],
    [without('critical'), /no rule for critical risk/],
    [{ ...POLICY, severe: { gate: 'G1' } }, /"severe" is not a risk level/],
    [{ ...POLICY, low: { gate: 'G9' } }, /must name a configured gate/],
    [{ ...POLICY, low: { gate: 'G3' } }, /needs "verifies"/],
    [{ ...POLICY, low: { gate: 'G1', approvals: 1 } }, /unknown key "approvals"/],
    [{ ...POLICY, low: { gate: 'G1', reviews: { bot: 1 } } }, /"bot" must be one of/],
    [{ ...POLICY, low: { gate: 'G1', reviews: { any: 1.5 } } }, /whole number/],
  ]) {
    assert.throws(() => validateMergePolicy(policy, GATES, fail), message);
  }
  assert.deepEqual(mergeRule({ merge_policy: POLICY }, 'high'), { gate: 'G2', reviews: { any: 0, agent: 1, human: 1 } });
  assert.equal(mergeRule({}, 'high'), null);
});

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const review = (result, executor, sha = SHA) => ({ check: 'review', result, executor, sha });
const need = (reviews) => ({ any: 0, agent: 0, human: 0, ...reviews });

test('reviews count only on the exact commit, by executor', () => {
  assert.deepEqual(reviewStatus([], SHA, need({})), { ok: true, missing: [], blocked: false, passes: 0 });
  const st = reviewStatus([review('pass', 'agent', OTHER), { check: 'integration', result: 'pass', executor: 'script', sha: SHA }], SHA, need({ any: 1 }));
  assert.deepEqual(st.missing, ['1 review(s) by an agent or a human']);
  assert.equal(reviewStatus([review('pass', 'human')], SHA, need({ any: 1 })).ok, true);

  const high = need({ agent: 1, human: 1 });
  assert.deepEqual(reviewStatus([review('pass', 'agent')], SHA, high).missing, ['1 human review(s)']);
  assert.deepEqual(reviewStatus([review('pass', 'human'), review('pass', 'human')], SHA, high).missing, ['1 agent review(s)']);
  assert.equal(reviewStatus([review('pass', 'agent'), review('pass', 'human')], SHA, high).ok, true);
  // Owed agent and human reviews also count toward the total.
  assert.deepEqual(reviewStatus([], SHA, need({ any: 3, agent: 1 })).missing, ['1 agent review(s)', '2 review(s) by an agent or a human']);
});

test('a failing review blocks until a human passes the commit after it', () => {
  const need1 = need({ any: 1 });
  const blocked = reviewStatus([review('pass', 'agent'), review('fail', 'agent')], SHA, need1);
  assert.deepEqual([blocked.ok, blocked.blocked], [false, true]);
  assert.equal(reviewStatus([review('fail', 'agent'), review('pass', 'agent')], SHA, need1).blocked, true);
  assert.equal(reviewStatus([review('fail', 'agent'), review('pass', 'human')], SHA, need1).ok, true);
  assert.equal(reviewStatus([review('fail', 'agent', OTHER)], SHA, need1).blocked, false);
});
