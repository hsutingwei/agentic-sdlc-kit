# ADR-0001: Support Claude Code first, keep the core tool-neutral

- **Status:** Accepted
- **Date:** 2026-11-23

## Context

The kit replaces a workflow in which a chat assistant planned and reviewed work
it could not see, while several different coding tools did the implementation.
The planner had no access to the source, and the work of each tool was recorded
differently or not at all.

Running planning, dispatch and review inside one agent tool solves the
visibility problem: the planner reads the code, dispatches sub-agents with a
chosen model and tool set, and checks their results against the diff. It also
gives complete telemetry, because hook events and transcripts exist for every
step.

At the same time, people who use other tools should be able to use as much of
the kit as possible.

## Decision

1. **The orchestration loop targets Claude Code only.** Planner, implementer,
   tester and reviewer all run as Claude Code sessions or sub-agents.
2. **Everything Claude Code specific lives in `adapters/claude-code/`**: hook
   entry points, transcript harvest, sub-agent definitions, permission settings.
3. **All other modules depend only on `core/` contracts and git.** Contracts use
   tool-neutral terms: model *tiers* (`light`, `standard`, `strong`) instead of
   model names, isolation levels (`fresh`, `sterile`) instead of CLI flags, and
   a `tool` field on records.
4. Agent rules are written in `AGENTS.md`, which several tools read; Claude
   Code loads it through an `@AGENTS.md` import in `CLAUDE.md`.
5. Adapters for other tools are not built in this project.

## Alternatives considered

- **Keep mixing tools as before.** Rejected: the planner stays blind, rule files
  multiply (one per tool), and records from the other tools would be `Partial`,
  which undermines the efficiency numbers the kit exists to produce.
- **Claude Code only, everywhere.** Rejected: hard-wiring Claude fields into the
  core would cost little now but would lock out other tools for no benefit, and
  it makes the core harder to test.

## Consequences

- Gates, worktree workflow, task CLI, reports and contracts work with any tool.
  Without an adapter, a tool gets no automatic events or token usage, so its
  rows are marked `Partial`. The README will carry a support matrix.
- One vendor means shared blind spots between implementer and reviewer.
  Mitigations: the reviewer runs with a fresh or sterile context, on a different
  model tier, and its detection rate is measured with seeded-defect cases
  (skill-regression) instead of being assumed.
- One vendor also means one quota: when it runs out, work stops. Model tiers and
  a concurrency limit reduce, but do not remove, this risk.
- Claude Code changes quickly. The adapter pins minimum versions, and `health`
  checks them.
