# skill-regression

Checks that a reviewer agent or skill still catches the defects it used to catch,
and raises no new false alarms, after its definition changes. Planned for **P8**.

- Each case has `suite.json`, `real.diff` (a clean change), `seeded.diff` (the same change with planted defects) and `NOTES.md` (case design, never shown to the reviewer).
- `regress.mjs prepare` copies inputs outside the repository under neutral file names, so the reviewer cannot find the answer by searching; `extract` parses the reviewer's output; `score` reports hits, misses and false alarms.
- Before a run, the loaded tool list and skill version are compared with the definition files.
- Stretch goal: run the same cases with different model tiers to show which tier a reviewer actually needs.
