# Sample report

**Fictional data.** Two weeks of invented work on the demo projects `demo-api`
and `demo-web` (tasks `DEMO-001`…`DEMO-012`), written as real events and usage
files by [`tools/lib/sample.mjs`](../../tools/lib/sample.mjs) and turned into
these files by the kit's own report code:

| File | Content |
|---|---|
| [`summary.md`](summary.md) | Headline efficiency, the task table, where human time went, tokens and task coverage, quota, every data-quality flag explained |
| [`tasks.csv`](tasks.csv) | One row per task with every measured column and its data-quality grade |
| [`verifications.csv`](verifications.csv) | One row per check (gate or human) |
| [`usage.csv`](usage.csv) | Tokens per task and model, plus use outside any task |

The sample shows each kind of row the kit can produce: accepted tasks, a
rejected and an abandoned one (they cost hours and earn nothing), a first check
that failed, escalations, a wait on a human decision, a later bug fix that marks
an escaped defect, a session whose usage was never harvested (`Partial`), and a
deferred and an open task (`Missing`).

Regenerate with `node tools/make-sample.mjs`; the output is the same on every
run, and a test checks that these files match it. Metric definitions are in
[docs/metrics.md](../../docs/metrics.md).
