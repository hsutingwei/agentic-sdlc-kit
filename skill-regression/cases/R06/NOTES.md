# R06 Sort the list by title (DEMO-206)

Never shown to a reviewer.

- **D1, the wrong comparison.** `localeCompare` sorts "a" before "B"; the brief
  asks for code-point order, where "B" (66) comes first. Subtle: it reads as an
  improvement. The seeded test uses lower-case titles only.
- **D2, unknown values ignored.** `?sort=name` returns the list unsorted with 200
  instead of 400. The seeded AC2 test only checks that `sort=title` works.
