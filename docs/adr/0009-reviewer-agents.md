# ADR-0009: Reviewer agents run sterile, on the exact commit, with proven findings

- **Status:** Accepted
- **Date:** 2026-11-25

## Context

Human review time is what the efficiency score divides by, and it is the first
bottleneck toward the 3× goal. In E1 the person read a short note on each change
before deciding; the note was written by hand. The merge policy
([ADR-0007](0007-risk-and-merge-policy.md)) already counts agent reviews and the
profiles ([ADR-0008](0008-plan-profiles.md)) already say how many verifiers each
risk deserves and which model and effort the reviewer gets, but nothing ran them.

A reviewer that reads the project's rules, memory or account-level instructions
is not independent (spike finding 9). A reviewer that only reads code produces
plausible findings that are sometimes wrong, and every wrong finding costs the
person time. An idea from pstack (its `interrogate` skill) is to keep only the
findings a run proves.

## Decision

1. **Sterile.** `asdk review run --task <ID>` writes a packet outside the
   repository (in the data folder): the brief from the reviewed commit, the diff
   against the merge base with the integration branch (very long lines
   shortened), the changed files, and the checks recorded for that commit (gate
   runs, other checks, scenario results of clean evidence). Claude Code runs there
   with `--safe-mode --no-session-persistence --strict-mcp-config --tools Read`
   and `--output-format json`, without the caller's `CLAUDE_CODE_*`, `AGENTIC_*`
   and model-selecting `ANTHROPIC_*` variables. Nothing else of the project is
   visible.
2. **The profile decides.** The reviewer role of the task's profile (or of the
   current plan) gives the model and effort at the effective risk, computed as
   `wt finish` does; the profile's verifiers for that risk give the number of
   independent reviewers (at least one). Each gets its own packet and run.
3. **A contract for the answer.** The verdict follows `review-verdict`: a
   decision (`accept`, `concerns`, `reject`), a summary, a result for every
   acceptance criterion of the brief and no others, findings sorted into
   `act_on`, `consider` and `noted`, and what to read first. An answer that is
   not such a verdict is recorded as `invalid` and records no review.
4. **Proven findings.** An `act_on` finding may carry a `node:test` file that
   asserts what the brief asks for. The kit runs it in a throw-away detached
   checkout of the commit; only a failure with an assertion proves the finding.
   When proving is on (the default), an unproven `act_on` finding is shown as
   `consider`, and an `accept` with a proven finding becomes `concerns`.
5. **Recorded on the commit.** Each verdict becomes
   `task verify --check review --executor agent --sha <commit>`: only `accept`
   passes. `concerns` and `reject` fail, and a failing review blocks the merge
   until a person passes it (ADR-0007). Findings are never applied.
6. **Data stays local.** Packets, answers, verdicts and notes stay in
   `<data>/reviews/`. The `review.run` event carries numbers only: status,
   decision, counts of findings and proofs, tokens, cost and time. Reports add
   these tokens to the task, because sterile runs fire no hooks and write no
   transcript.
7. **Settings.** `.asdk/review.json` on the main checkout sets the language of
   the notes (English by default), whether to prove, and the time limits.

## Consequences

- Medium-risk changes with one verifier can merge on an agent review alone, if
  the merge policy says so; high risk still needs a person in the demo policy.
- The person reads `asdk review show --task <ID>`: the verdict with proofs.
- A rebase changes the commit, so `wt finish` after a moved integration branch
  needs new reviews, as it already needs a new gate run.
- Running a reproduction executes code written by a model, as the person, with
  node. The import check (only some `node:` modules and relative imports, no
  `require`, no dynamic `import()`) and the time limit guard against accidents,
  not against a hostile model; `"prove": false` turns it off.
- Reviewer usage is counted per task, but not yet in the AI time, which comes
  from hook events.
- Whether a reviewer catches real defects and how often it raises false alarms is
  not shown by this ADR: skill regression (P8b) and the E1 retrospective (E1d)
  measure it.
- First real run (2026-11-25, Claude Code 2.1.330, `max` profile, Sonnet at high
  effort, one fictional change to the demo with a planted defect): with only the
  Read tool the reviewer returned a valid verdict in 22 s for USD 0.06 at list
  price, rejected the change, and its one reproduction proved the planted
  defect. Two other real problems it named had no reproduction and were shown as
  `consider`; no session transcript was written.
