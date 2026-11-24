# ADR-0003: Edit Claude Code settings on their text, and undo exactly what was added

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

Recording needs the kit's hook in Claude Code's settings. The user-level file
(`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json`) belongs to the
user: it holds their model choice, permissions, their own hooks, and Claude Code
writes to it too. The kit must be able to leave without a trace: the spec asks
that uninstall restores everything else in the file **byte for byte**.

Parsing the file and writing it back with `JSON.stringify` cannot do that: it
changes indentation, line endings and spacing, drops a byte-order mark, and
re-serialises values the user wrote differently. Restoring a backup taken at
install time cannot do it either, because it would throw away everything the
user or Claude Code changed since.

## Decision

1. **Edit the text, not the value.** `core/json-text.mjs` parses strict JSON into
   spans and inserts or removes one child at a time, following the file's own
   indentation, line ending, key separator and BOM. Every other byte is kept.
2. **Insert and remove are exact inverses.** A child appended to a non-empty
   container is written as `,` + the container's own leading whitespace + child,
   and removing it deletes exactly those bytes. A child put into an empty
   container replaces its inner whitespace, which is returned and kept.
3. **An install record says what install created.** A manifest in `state/`
   lists the file (if install created it), the `hooks` member and event members
   install added, and the inner whitespace of containers that were empty.
   Uninstall removes the kit's entries, then only those containers, and only
   when they are empty again; it deletes the file only if install created it and
   nothing else is in it. Content added by anyone else stays.
4. **Refuse rather than guess.** Files that are not UTF-8, not strict JSON
   (comments, trailing commas), or whose `hooks` is not an object of arrays are
   reported and left alone.
5. **Never lose a concurrent write.** Before every write the current bytes are
   copied to `backups/claude-settings/`. The file is read again just before the
   write; if it changed since the edit was computed, nothing is written and the
   command asks to be run again. Writes go to a temporary file that is renamed.
6. **Recognise the kit's entries by their exact command**, recorded in the
   manifest (including commands of earlier installs from another checkout).
   `uninstall --all` also removes any entry whose command runs `asdk.mjs hook`.

## Alternatives considered

- **Parse, change, stringify.** Simple, but rewrites the whole file; fails the
  byte-exact requirement on the first file indented with tabs or saved with CRLF.
- **Back up at install, restore at uninstall.** Exact only if nothing changed in
  between; otherwise it silently discards the user's and Claude Code's edits.
- **A separate settings file.** Claude Code merges hooks from user, project and
  local settings, but its settings documentation describes no way to include an
  extra user-level file, so a user-level hook still means editing
  `settings.json`.

## Consequences

- Install then uninstall with no edits in between returns the original bytes;
  tests check this for LF, CRLF, tabs, a BOM, compact one-line files, files
  with the user's own hooks, empty files and a missing file.
- A JSON-with-comments settings file is refused. If Claude Code starts writing
  comments, the parser has to learn to skip them; the inverse-pair rule stays.
- The manifest is local state. If it is lost, uninstall still removes the kit's
  entries but leaves containers that are now empty, and says so.
- There is a small window between the final re-read and the rename in which a
  concurrent write could still be lost; the backup covers it.
