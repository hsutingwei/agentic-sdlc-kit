# R06 Sort the list by title (DEMO-206)

Never shown to a reviewer.

- **D1, the wrong comparison.** `localeCompare` sorts "a" before "B"; the brief
  asks for plain string comparison, where "B" (66) comes first. Subtle: it reads as an
  improvement. The seeded test uses lower-case titles only.
- **D2, unknown values ignored.** `?sort=name` returns the list unsorted with 200
  instead of 400. The seeded AC2 test only checks that `sort=title` works.

The first baseline (2026-11-25) found that an earlier brief asked for code-point
order while the clean change compares UTF-16 code units, which differs for
characters outside the BMP; the brief now says what the clean change does.

The scope-check rerun (2026-11-25) proved that the clean change took the first of
a repeated `sort`, which the brief did not settle; the brief now asks for 400, both
variants refuse it, and the clean test checks it.
