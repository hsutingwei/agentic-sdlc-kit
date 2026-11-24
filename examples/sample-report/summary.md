# Task scorecard

Generated 2026-11-14T09:00:00.000Z. 12 task(s): 9 Complete, 1 Partial, 2 Missing.

## Efficiency

**3.31×** over 9 Complete task(s): 30.1 h of quality-weighted estimated work (7 accepted) for 9.09 human hours. Rejected and abandoned tasks count their hours and earn nothing.

Efficiency = estimate without AI ÷ human hours, times a quality factor (see docs/metrics.md).

## Tasks

| Task | Project | Outcome | Lead (h) | AI (h) | Human (h) | Waiting on human (h) | Estimate (h) | Efficiency | Checks | First pass | Escalations | Output tokens | Data quality |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DEMO-001 | demo-api | accepted | 4 | 1.17 | 0.92 | – | 6 | 6.52 × 0.6 = 3.91 | 3 | no | 0 | 3,711 | Complete |
| DEMO-002 | demo-api | accepted | 2 | 0.42 | 0.42 | – | 2 | 4.76 | 2 | yes | 0 | 9,248 | Complete |
| DEMO-003 | demo-web | accepted | 6 | 2.17 | 1.92 | – | 8 | 4.17 × 0.8 = 3.33 | 4 | no | 1 | 11,645 | Complete |
| DEMO-004 | demo-api | accepted | 3 | 1 | 0.67 | – | 4 | 5.97 | 2 | yes | 0 | 4,803 | Complete |
| DEMO-005 | demo-web | accepted | 2.5 | 0.75 | 0.42 | – | 3 | 7.14 | 2 | yes | 0 | 8,869 | Complete |
| DEMO-006 | demo-api | accepted | 10 | 3 | 2.83 | 1 | 12 | 4.24 × 0.8 = 3.39 | 3 | no | 1 | 15,300 | Complete |
| DEMO-007 | demo-web | rejected | 3.33 | 1.33 | 1.08 | – | 3 | 0 | 1 | yes | 0 | 9,078 | Complete |
| DEMO-008 | demo-api | accepted | 1.5 | 0.33 | 0.33 | – | 1.5 | 4.55 | 2 | yes | 0 | 9,287 | Complete |
| DEMO-009 | demo-web | accepted | 1 | 0.25 | 0.25 | – | 1 | 4 | 2 | yes | 0 | 0 | Partial |
| DEMO-010 | demo-api | abandoned | 2 | 0.67 | 0.5 | – | 2 | 0 | 2 | no | 1 | 7,796 | Complete |
| DEMO-011 | demo-web | deferred | 2 | 0.83 | 0.33 | – | 5 | – | 0 | – | 0 | 9,606 | Missing |
| DEMO-012 | demo-api | active | – | 0.67 | 0.25 | – | 4 | – | 0 | – | 0 | 6,246 | Missing |

## Where human time went

spec 3.33 h · review 4.34 h · fix 1.25 h · acceptance 0.99 h · other 0 h (total 9.91 h)

## Tokens

- claude-haiku-5-5: 12 responses, 5,333 output tokens
- claude-opus-5-5: 30 responses, 36,952 output tokens
- claude-sonnet-5-5: 33 responses, 60,906 output tokens

Task coverage: 93% of 103,191 output tokens were spent inside tasks; 1 of 13 session(s) not harvested.

## Quota

Plan: max-5x (from 2026-11-01T09:00:00.000Z).
- five_hour: 22% at 2026-11-13T17:00:00.000Z
- seven_day: 67% at 2026-11-13T17:00:00.000Z, resets 2026-11-16T09:00:00.000Z

## Data quality

`Complete`: every input was recorded. `Partial`: a score is shown but something is doubtful. `Missing`: no score is possible. Only Complete tasks count in the efficiency above.

- `deferred`: the task was deferred: it is neither done nor dropped, so it is not scored (DEMO-011)
- `no_verification`: no check was recorded, so the first-pass rate is unknown (DEMO-011, DEMO-012)
- `open_task`: the task has not ended, so lead time, outcome and score are unknown (DEMO-012)
- `usage_not_harvested`: token usage of a session is missing (no transcript, or asdk harvest not run) (DEMO-009)

Empty cells were not measured; they are never filled with estimates. Limits are listed in docs/metrics.md.
