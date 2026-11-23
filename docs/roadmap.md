# Roadmap

Each phase starts with a written plan that is confirmed before work begins, and
ends with `npm test` actually run and the result reported.

| Phase | Scope | Status |
|---|---|---|
| P0 | Skeleton, test runner and sandbox, denylist pre-commit hook, CI with gitleaks, `core/` contracts and validator, ADR-0001, Claude Code behaviour spike | in progress |
| P1 | End-to-end slice on DEMO-001: `wt new` → sub-agent implements → G1 → `task verify` → merge to `dev` → `task end` → one scorecard row | |
| P2 | Collector: project registry (worktree-aware), hook recording incl. `SubagentStart`/`SubagentStop`, `hooks install/uninstall` (byte-exact), `enable/disable`, `health` | |
| P3 | Collector: task lifecycle CLI, lock files, multi-process contention test | |
| P4 | Collector: token usage harvest, quota snapshots, plan changes | |
| P5 | Collector: reports, push check, efficiency scorecard, fictional sample data | |
| P6 | Governance templates and gates applied to `examples/demo-api`, role and model-tier profiles | |
| P7 | Orchestration: planner workflow, report verification, isolation levels, worktree pool, dispatch guard, `budget status` | |
| P8 | Skill regression and reviewer cases | |
| P9 | Documentation, ADRs, README, pre-publication checks (full-history scan, action pinning) | |

**Demo-ready line:** after P1 and P5 the kit can be shown end to end; later
phases deepen it.

## Decisions so far

- **Tool scope** – Claude Code first, tool-neutral core ([ADR-0001](adr/0001-claude-code-first-tool-neutral-core.md)).
- **Branches** – `main` is released to the git server; `dev` integrates; every task works in its own worktree branched from `dev`.
- **Context isolation** – implementers run as sub-agents with a fresh context; testers and reviewers run `sterile`: a headless run outside the repository with CLAUDE.md, memory, skills, hooks and MCP disabled. A stricter mode that needs an API key is optional.
- **Efficiency score** – the baseline is a human estimate without AI, recorded at task start and never edited. Quality discounts apply: first-pass rate, rework, escalations, and escaped defects (a fix task links back with `--fixes`). Only `Complete` rows are scored, and the estimate's bias is a documented limitation.
- **Parallel work** – a WIP limit, a "waiting for human" time metric, an overlap warning on declared paths, and G2 on the branch rebased onto the latest `dev`.
- **Worktrees** – short slot names under a short, configurable root (Windows path length); dependencies reinstalled only when the lockfile hash changes; local files copied only from an explicit, empty-by-default allowlist; a pool of reusable slots (P7).
- **Dispatch guard** – a Claude Code hook, not an MCP server: it is enforced, costs no tokens and reuses recorded events. A CLI serves queries. The quota data source is decided after the spike.
- **Licence holder** – "agentic-sdlc-kit contributors".
