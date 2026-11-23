# collector

Records one task from start to acceptance and turns the records into metrics
with an explicit data-quality flag on every row.

- **P1 (done)** – `asdk project add|list`, `asdk resolve`, `asdk task start|verify|end|list`, `asdk report`; append-only event store ([ADR-0002](../docs/adr/0002-append-only-events.md)); a scorecard row per task with data-quality flags.
- **P2** – project registry (longest-path match, worktrees resolved through the git common directory), hook recording including `SubagentStart`/`SubagentStop`, `hooks install/uninstall` with byte-exact restore, `health`.
- **P3** – task lifecycle CLI and lock files for concurrent writers.
- **P4** – token usage harvest (idempotent, tolerant of transcript format changes), quota snapshots, plan changes.
- **P5** – reports (CSV and `summary.md`), push check, efficiency scorecard, fictional sample data.

Data lives in `~/.agentic-metrics/` (overridable with `AGENTIC_METRICS_HOME`) and
is never committed. Only metadata is stored: no prompt text, no file contents.
