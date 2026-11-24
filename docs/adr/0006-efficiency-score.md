# ADR-0006: Efficiency is estimated work per human hour, discounted for quality

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

The goal of the kit is to show whether AI-assisted development makes a person at
least three times as productive. That needs one number that is hard to game, and
honest about what it does not know.

Candidates that look obvious mislead: pull requests per month count maintenance
and churn; AI time or tokens measure cost, not value; lead time drops when work
is cut into pieces. What the person cares about is how much of *their* time a
piece of work took, compared with doing it without AI.

## Decision

1. **Value is the estimate without AI**, entered at `task start`, never edited.
   It is the only baseline available before the work; recording it first keeps
   hindsight out.
2. **Cost is human hours**, timed per activity (spec, review, fix, acceptance),
   because the person's time is the scarce resource. AI time and tokens are
   reported next to it, not mixed into it.
3. **A quality factor** discounts work that needed rework (first check failed:
   −0.1), human intervention (−0.1 per escalation, at most −0.3) or let a defect
   escape (a later `--fixes` task: −0.3), never below 0.5. The weights are
   configuration.
4. **The headline counts failures.** It divides the quality-weighted estimate of
   accepted tasks by the human hours of *all* scored tasks; rejected and
   abandoned tasks add hours and no value.
5. **Only Complete rows are scored.** A row with any doubtful input is shown
   with its flags but stays out of the headline; a row without the inputs for a
   score shows none.

## Alternatives considered

- **Throughput (tasks or PRs per week).** Rewards splitting work and ignores how
  much of it a person had to redo.
- **AI time ÷ human time.** Measures delegation, not value; a slow agent would
  look good.
- **Story points or other relative units.** Need a team ritual to calibrate and
  still are an estimate; hours are simpler for one person.
- **Scoring Partial rows too.** More data, but the headline would then depend on
  numbers the report itself calls doubtful.

## Consequences

- The estimate's bias passes straight into the score. It is documented, and E1
  (the experiment phase) compares the same kinds of tasks across profiles, where
  the bias is the same on both sides.
- People must time themselves. `task end` stops a forgotten timer and flags it;
  long periods are flagged too.
- The weights are a judgement. They are visible in every summary's formula and
  can be changed without touching code.
