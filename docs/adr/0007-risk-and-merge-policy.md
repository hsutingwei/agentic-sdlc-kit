# ADR-0007: Merging follows the effective risk, under the integration branch's rules

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

Human review time is the largest cost the efficiency score divides by. Reviewing
every change in full wastes it; reviewing none lets risky changes through. The
amount of checking should follow the risk of the change, and three things make
that hard:

- A task's declared risk is a guess made before the work, by the person or agent
  who wants the work to be easy to merge.
- A verdict is only meaningful for the commit it looked at. Rebasing, a later
  fix-up commit or a merge creates a different tree.
- The rules live in the repository. A branch that edits `.asdk/gates.json` could
  relax the very policy that decides whether it may merge.

## Decision

1. **Effective risk is the higher of the declared risk and a path minimum.**
   `.asdk/risk-paths.json` maps path globs to a minimum risk; the gate diffs the
   commit it verifies against the merge base with the integration branch and
   takes the highest match. Paths can raise a task's risk, never lower it. The
   gate summary records all three values, and the gate output names the paths.
2. **A merge policy per risk level**, in `.asdk/gates.json`: which gate must pass
   and how many reviews (`any`, `agent`, `human`) must pass. The demo uses G1 for
   low; G2 and one review for medium; G2 and an agent and a human review for high
   and critical. Critical is treated as high until a stricter rule is needed.
3. **Every verdict is bound to the exact commit that is merged.** `wt finish`
   rebases first, then gates and checks reviews on the rebased commit, and
   merges only while the integration branch is still its ancestor. A review is
   recorded with `task verify --check review --sha <commit>`; one without a
   commit is refused. A failing review on that commit blocks the merge until a
   human passes it; fixing the branch makes a new commit that needs new reviews.
4. **The rules come from the integration branch.** `wt finish` reads the policy,
   the gates and the risk paths from the main checkout, which must be on the
   integration branch and clean. Changes to those files take effect only once
   merged, and the demo marks `.asdk/**`, `.claude/**`, `AGENTS.md` and
   `CLAUDE.md` as high risk, so changing them needs a human review.
5. **Pushing to `main` is a separate, human step.** G3 (clean tree, then the full
   checks) verifies the commit to be pushed; with `push_check.block` the
   pre-push hook refuses a commit without a passing G3 run. Nothing merges into
   `main` automatically.

## Consequences

- Low-risk work merges into `dev` without a person, which is where the time is
  saved; the person reviews what the paths say is risky.
- A task that touches a risky path waits for reviews even if it was declared
  low. The demo's DEMO-001 does: it changes the HTTP layer and becomes medium.
- Review counts are configuration, so P6b can take them from the plan profile
  (more independent verifiers on a large plan) without changing this rule.
- Reviewer agents themselves arrive in P8; until then a review is whatever an
  agent or a human records, and its quality is not measured.
- `git push --no-verify` still bypasses the hook. The push check then reports
  the commit as `missing`, so the bypass is visible, not prevented.
