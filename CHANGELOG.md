# Changelog

All notable changes. Versions follow [Semantic Versioning](https://semver.org/);
until 1.0 the command line and file formats may still change.

## 0.1.0 – 2026-11-24

The first version that can be shown end to end: phases P0 to P5 of the
[roadmap](docs/roadmap.md).

### Workflow (P1)

- `asdk wt new` / `wt finish`: one worktree and branch per task, cut from `dev`;
  finishing rebases onto the latest `dev`, runs the gate on the rebased commit and
  merges with `--no-ff` only while `dev` is still an ancestor of the verified
  commit.
- `asdk gate run`: gates and their steps are configuration (`.asdk/gates.json`);
  each run is bound to its commit and can record the task's check.
- `examples/demo-api` and `tools/demo-setup.mjs`: a throw-away demo project.

### Recording (P2–P4)

- `asdk hook`: Claude Code hook that records metadata only (names, sizes, ids),
  including `SubagentStart`/`SubagentStop` and `PostToolUseFailure`; never blocks.
- `asdk hooks install|uninstall|status`: edits settings on their text; uninstall
  gives back the original bytes ([ADR-0003](docs/adr/0003-byte-preserving-settings-edits.md)).
- `asdk enable|disable`, `asdk health`, `asdk session list|set-project`,
  `asdk project add|remove|list`, `asdk resolve`.
- Task lifecycle: `task start|verify|update|escalate|end|list`; human time with
  `human start|stop|adjust|status`; lock files around every check-then-write
  ([ADR-0004](docs/adr/0004-lock-files.md)).
- `asdk harvest` and `asdk usage`: token usage from transcripts, one count per API
  response ([ADR-0005](docs/adr/0005-usage-harvest.md)); `task end` harvests the
  task's sessions.
- `asdk quota snapshot|plan-change|status`, including stream-json input.

### Reports (P5)

- `asdk report [--harvest]`: `tasks.csv`, `verifications.csv`, `usage.csv`,
  `summary.md` with AI and human time, tokens, quality-adjusted efficiency, task
  coverage, quota and a data-quality grade per row
  ([metrics](docs/metrics.md), [ADR-0006](docs/adr/0006-efficiency-score.md)).
- `asdk push-check`: pushes to the main branch against gate passes on the same SHA.
- `tools/make-sample.mjs` and [examples/sample-report](examples/sample-report/):
  fictional sample data and its reports.

### Quality

- Node.js 22+, no runtime dependencies, `node:test`; CI on Ubuntu and Windows with
  Node 22 and 24, plus gitleaks; tests run in sandboxes with CJK paths and spaces.
