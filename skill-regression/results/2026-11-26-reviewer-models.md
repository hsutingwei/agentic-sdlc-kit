# Skill regression: reviewer models and effort

Reviewer `0f6759901d5d` (reviewer.md) with the kit's scope check, Claude Code
2.1.330, kit 183dd3f, the night of 2026-11-25 to 26. Each run is 16 sterile reviews:
the clean and the seeded change of the eight cases. Prices are list prices on a
subscription.

| | sonnet high (max profile), 3 runs | sonnet medium (pro profile) | haiku high |
|---|---|---|---|
| Planted defects found | 15 of 15 in every run | 15 of 15 | 14 of 15 |
| … proven | 15 in every run | 15 | 14 |
| Seeded changes not accepted | 8 of 8 | 8 of 8 | 7 of 7 usable |
| Clean changes accepted | 8 of 8 | 8 of 8 | **5 of 8** |
| False alarms (act_on after proofs) | 0 | 0 | 0 |
| Runs without a usable verdict | 0 | 0 | **1** |
| USD per run of 16 | 0.72, 0.75, 0.75 | 0.63 | **0.07** |
| Median seconds per review | 17, 16, 16 | 14 | 26 |

## Notes

- **Sonnet is steady.** Three runs at high effort gave the same table, so the
  findings that appeared on clean R01 and R06 in earlier runs came from the
  cases, which were since corrected, not from the reviewer's variance.
- **Medium effort lost nothing here** and cost 16 % less, with reviews about a
  sixth faster. The cases are small; this does not yet show that medium is as
  good on larger changes, so the max profile keeps high.
- **Haiku is a ninth of the price, but costs the person time.** It found every
  defect in the changes it reviewed. One answer was not valid JSON (a value in
  single quotes), so that change, R04's seeded one, has no verdict and its defect
  counts as missed. Three clean changes got `concerns` with no `act_on` finding:
  it marked a criterion unclear because the route code it calls was not among
  the changed files in the packet. Each would wait for a person, which is the
  time the kit is meant to save, so the profiles keep sonnet for reviewers.
- A packet that also carried the unchanged code a change calls into might help a
  smaller model; not tried.
