# R03 Add an optional note to todo items (DEMO-203)

Never shown to a reviewer. Declared low risk: only `src/todos.mjs` changes.

- **D1, bytes for characters.** `Buffer.byteLength` instead of counting
  characters: 500 Chinese characters are 1,500 bytes and are refused. The seeded
  test uses ASCII, where both agree.
- **D2, null kept.** `note: null` sets the field to null instead of removing it.
  The seeded test checks only that the note is falsy.
