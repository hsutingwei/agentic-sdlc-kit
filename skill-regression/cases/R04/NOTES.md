# R04 Count todo items (DEMO-204)

Never shown to a reviewer. One defect.

- **D1, no method check.** POST, PATCH and DELETE on `/todos/count` answer 200
  with the counts. The seeded test drops the 405 loop.
