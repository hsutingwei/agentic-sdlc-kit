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
