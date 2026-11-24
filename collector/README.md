# collector

Records one task from start to acceptance and turns the records into metrics
with an explicit data-quality flag on every row.

- **P1 (done)** – `asdk project add|list`, `asdk resolve`, `asdk task start|verify|end|list`, `asdk report`; append-only event store ([ADR-0002](../docs/adr/0002-append-only-events.md)); a scorecard row per task with data-quality flags.
- **P2 (done)** – `asdk session list|set-project` (manual project override, recorded as a new event), `asdk project remove`, `asdk enable|disable`, `asdk health` (checks plus one timed hook call); worktrees are resolved by reading `.git` entries, without starting git. Settings live in `config.json`: `projects`, `worktrees.root`, `record_unregistered`.
- **P3 (done)** – `asdk task update|escalate`, `asdk human start|stop|adjust|status`; lock files around every read -> check -> write ([ADR-0004](../docs/adr/0004-lock-files.md)); the scorecard fills human hours.
- **P4** – token usage harvest (idempotent, tolerant of transcript format changes), quota snapshots, plan changes.
- **P5** – reports (CSV and `summary.md`), push check, efficiency scorecard, fictional sample data.

Data lives in `~/.agentic-metrics/` (overridable with `AGENTIC_METRICS_HOME`) and
is never committed. Only metadata is stored: no prompt text, no file contents.
