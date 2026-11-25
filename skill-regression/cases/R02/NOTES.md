# R02 Clear finished items in one request (DEMO-202)

Never shown to a reviewer.

- **D1, a missing parameter check.** Every `DELETE /todos` clears the finished
  items and answers 200, so a client that sends DELETE to the collection by
  mistake loses data. The seeded test drops the AC2 block.
- **D2, the wrong count.** `removeDone()` returns how many items are left, not how
  many it removed. The seeded test only checks that `deleted` is a number.
