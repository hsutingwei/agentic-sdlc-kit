# R07 Keep at most 100 todo items (DEMO-207)

Never shown to a reviewer.

- **D1, off by one.** `items.size > MAX_ITEMS` lets the 101st item in. The seeded
  tests fill 101 items before expecting a refusal.
- **D2, the wrong status.** A full store answers 400, not the 409 the brief asks
  for. The seeded test accepts any status from 400.
