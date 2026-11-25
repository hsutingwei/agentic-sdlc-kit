# Skill regression: baseline: sonnet high, reviewer v1

Reviewer `d129d999f0c3` (reviewer.md), sonnet at high effort, Claude Code 2.1.330, kit 2453cd0, 2026-11-25.

| | |
|---|---|
| Planted defects found | 15 of 15 (100 %) |
| … as act_on | 14 |
| … proven by a reproduction | 14 |
| Seeded changes not accepted | 8 of 8 |
| Clean changes accepted | 8 of 8 |
| False alarms (act_on on a clean change, after proofs) | 0 |
| Runs without a usable verdict | 0 |
| List price, USD | 0.74 |

| Case | Seeded decision | Defects (✓ found, ! act_on, ★ proven) | Clean decision | False alarms |
|---|---|---|---|---|
| R01 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
| R02 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
| R03 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
| R04 | reject | D1 ✓!★ | accept | 0 |
| R05 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
| R06 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
| R07 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
| R08 | reject | D1 ✓!★, D2 ✓ | accept | 0 |
## Notes

- A first run the same day, on the same reviewer and model, raised one `act_on`
  finding on each of the clean changes of R01 and R06, and both were proven: the
  clean R01 capped `offset` at `Number.MAX_SAFE_INTEGER`, which the brief did not
  allow, and the R06 brief asked for code-point order while the clean code
  compares UTF-16 code units. Both cases were corrected (see their `NOTES.md`)
  and this table is the run after the correction. The reviewer was right; the
  ground truth was not.
- R08 D2 (an edit to `.asdk/risk-paths.json`, which the brief forbids) was found
  but not proven: a reproduction may not read files, so the finding was shown as
  `consider`. Scope breaches can be decided by the kit itself, without a test.
- 16 reviews of 12 to 24 seconds each (median 16 s, 4.4 minutes in all); USD 0.74
  at list price on a subscription.
