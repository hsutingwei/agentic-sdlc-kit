# R05 Replace a todo item with PUT (DEMO-205)

Never shown to a reviewer.

- **D1, merge instead of replace.** A field left out keeps the old value
  (`?? items.get(id).done`) instead of its default. The seeded test replaces an
  item that was never finished, where both give false.
- **D2, create on unknown id.** The `items.has(id)` check is gone, so PUT on a new
  id creates an item with that id (and can collide with later ids). An optional
  chain keeps it from crashing; the seeded test for AC2 now only checks that the
  id is kept.
