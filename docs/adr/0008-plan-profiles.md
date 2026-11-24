# ADR-0008: Plan profiles choose model, effort, isolation and verifiers per role

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

The kit is developed on a top-tier subscription but has to serve ordinary ones.
On a top-tier plan the strongest model at a high reasoning effort is affordable
for most work, and several independent verifiers are worth their tokens. On Pro,
the same choices would exhaust the quota in a day. What is right depends on the
plan, on the role (planning, implementing, testing, reviewing) and on the risk
of the task. Hard-coding a model in each agent file ties a project to one plan,
and the person has to remember to change every file when the plan changes.

Claude Code lets a sub-agent definition set `model` and `effort`, and a headless
run take `--model` and `--effort`. Two environment variables,
`CLAUDE_CODE_EFFORT_LEVEL` and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`, override both.

## Decision

1. **A profile per plan.** `governance/profiles/profiles.json` holds `ultra`,
   `max` and `pro`, and maps plan names (`max-5x`, `max-20x`, …) to them. The
   plan comes from `--plan`, or from the latest `asdk quota plan-change`, so a
   plan change recorded for the reports also switches the profile.
2. **Roles map to tiers, tiers to models.** A role has a tier (`light`,
   `standard`, `strong`, the vocabulary of task briefs), an effort and an
   isolation (`fresh` or `sterile`), with overrides by risk. Each profile maps
   tiers to models. A profile also sets the number of independent verifiers per
   risk.
3. **A project replaces whole profiles.** `.asdk/profiles.json` can add plans
   and define profiles; one with the name of a kit profile replaces it as a
   whole. Merging field by field would make the result hard to read.
4. **Applied explicitly.** `asdk profile apply` rewrites only the `model` and
   `effort` lines of `.claude/agents/*.md` whose name is a role, and shows the
   change first with `--dry-run`. `asdk profile show --format claude-args`
   prints the flags for a headless run. Nothing changes agent files behind the
   person's back, and in the demo editing `.claude/**` is high risk, so the
   change itself is reviewed.
5. **Recorded on the task.** `task start` records the profile, chosen with
   `--profile` or taken from the current plan (marked `auto`). Reports show it,
   so experiments can compare profiles on real tasks.
6. **Verifier counts reach the merge policy.** A review count in `merge_policy`
   may be `"profile"`: the task's profile decides how many reviews its effective
   risk needs; a task without a profile needs one.
7. **Overrides are visible.** `asdk health` warns when one of the two environment
   variables is set, since profiles then have no effect.

## Consequences

- Moving from one plan to another is one `asdk quota plan-change` and, for
  sub-agents, one `asdk profile apply`.
- The starting values are guesses. E1 measures them on real tasks; until then
  they are the roadmap's table, not findings. Whether every model accepts every
  effort level (for example `haiku` with `medium`) is also left to E1.
- Agent files hold one risk level's settings at a time. Per-task settings for
  sub-agents need the planner workflow of P7, which can pass them per dispatch.
- Isolation is recorded but not yet enforced: sterile runs arrive with the
  orchestration work in P7.
