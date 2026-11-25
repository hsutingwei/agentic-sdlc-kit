# R01 Page through the todo list (DEMO-201)

Never shown to a reviewer.

- **D1, off by one in the end index.** `slice(offset, limit)` instead of
  `slice(offset, offset + limit)`: the first page is right, any later one is
  short or empty. The seeded tests only ask for the first page and for an offset
  without a limit, which both still work.
- **D2, a lower bound one too low.** `limit=0` passes the range check and returns
  an empty page instead of 400. The seeded tests drop `?limit=0` from the list of
  bad values, so they still look complete.

Both are plain against AC1 and AC2; a reviewer who reads `page()` with the
criteria open should find both.

The first baseline (2026-11-25) found that an earlier clean change capped offset at
`Number.MAX_SAFE_INTEGER`, which the brief does not allow; the cap is gone and the
clean test asks for a larger offset.
