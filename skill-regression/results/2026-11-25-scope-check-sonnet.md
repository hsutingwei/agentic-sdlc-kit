# Skill regression: sonnet high, with the kit's scope check

Reviewer `0f6759901d5d` (reviewer.md), sonnet at high effort, Claude Code 2.1.330, kit 030c543, 2026-11-25.

| | |
|---|---|
| Planted defects found | 15 of 15 (100 %) |
| … as act_on | 15 |
| … proven (a failing test, or the kit's scope check) | 15 |
| … found only by the kit's scope check | 0 |
| Seeded changes not accepted | 8 of 8 |
| Clean changes accepted | 8 of 8 |
| False alarms (act_on on a clean change, after proofs) | 0 |
| Runs without a usable verdict | 0 |
| List price, USD | 0.72 |

| Case | Seeded decision | Defects (✓ found, ◆ only by the kit, ! act_on, ★ proven) | Clean decision | False alarms |
|---|---|---|---|---|
| R01 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
| R02 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
| R03 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
| R04 | reject | D1 ✓!★ | accept | 0 |
| R05 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
| R06 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
| R07 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
| R08 | reject | D1 ✓!★, D2 ✓!★ | accept | 0 |
## Notes

- Against the [baseline](2026-11-25-baseline-sonnet.md): R08 D2, the edit to
  `.asdk/risk-paths.json` the brief forbids, is now proven by the kit's scope
  check, so all fifteen planted defects are proven. The reviewer named that file
  itself; no defect was found only by the kit. `compare` found no regression.
- A first run with the scope check raised one proven `act_on` finding on the
  clean R06: it took the first of a repeated `sort`, which the brief did not
  settle. R01 read `limit` and `offset` the same way. Both briefs now ask for 400
  on a repeated parameter (see their `NOTES.md`), and this table is the run after
  that correction. As in the baseline, the finding was right and the case was not.
- One review per change: a finding that appears in one run and not in another is
  within the reviewer's variance, so a single new finding is weak evidence of a
  regression. Reviewing each change two or three times would separate the two.
- 16 reviews of 12 to 26 seconds each (median 17 s, 4.6 minutes in all); USD 0.72
  at list price on a subscription.
