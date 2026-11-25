# skill-regression

Checks that the reviewer agent ([ADR-0009](../docs/adr/0009-reviewer-agents.md))
still finds the defects it used to find, and raises no new false alarms, after its
instructions (`governance/review/reviewer.md`), its model or Claude Code changes.

## Cases

Eight fictional features on `examples/demo-api`, none of them an E1 task, each in a
clean and a seeded variant: fifteen planted defects in all (off-by-one limits, a
missing parameter or method check, bytes counted as characters, a merge where a
replace was asked for, the wrong comparison or status code, an edit outside the
brief's scope).

```
cases/R01/brief.json          the brief the reviewer gets
cases/R01/real/               files the clean change adds (its tests)
cases/R01/real.edits          edits the clean change makes to existing files
cases/R01/seeded.edits        the planted defects ("defect Dn") and the test edits that let them through ("hides Dn")
cases/R01/checks/Dn.test.mjs  ground truth: passes on the clean change, fails on the seeded one
cases/R01/suite.json          each defect's title, file and the words that name it
cases/R01/NOTES.md            the case design, never given to a reviewer
```

Edits are plain text, so no escaping is needed:

```
@@ src/server.mjs defect D1
<<<
the exact text to find, once
===
what to put there
>>>
```

`npm test` proves every case fair: the clean change passes the demo's tests and
every check; the seeded change still passes the demo's tests (a gate would let it
through to the reviewer) while each check fails, through an assertion or an error
thrown by the code under test.

## Running

```sh
node skill-regression/regress.mjs prepare ~/asdk-regress/run-1
node skill-regression/regress.mjs run ~/asdk-regress/run-1            # the max profile's reviewer at medium risk
node skill-regression/regress.mjs score ~/asdk-regress/run-1 --label "sonnet, reviewer v1"
node skill-regression/regress.mjs compare ~/asdk-regress/run-1         # against baseline.json
node skill-regression/regress.mjs compare ~/asdk-regress/run-1 --write-baseline
```

- `prepare` builds each variant as a repository outside the kit under a neutral
  ten-character name; which is which is only in `key.json`.
- `run` reviews each one exactly as `asdk review run` does: a sterile packet, the
  stream's init event checked (only the Read tool, no MCP server), the verdict
  checked against `review-verdict`, `act_on` findings proven. `--model`,
  `--effort`, `--profile` and `--risk` choose the reviewer; `--only R01,R02`
  limits the cases. Finished reviews are kept, so a stopped run continues.
- `score` counts, per planted defect, whether a finding matched it (same file
  and within five lines, or one of the defect's words), whether that finding was
  `act_on`, and whether it was proven; on clean changes, every `act_on` finding
  left after the proofs is a false alarm.
- `compare` lists defects found in the baseline and missed now, and clean changes
  with more false alarms; it exits 1 when there is any.

Answers, packets and repositories stay in the run folder. `baseline.json` and the
result tables in [`results/`](results/) hold numbers only.
