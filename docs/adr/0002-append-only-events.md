# ADR-0002: Record events append-only and derive state from them

- **Status:** Accepted
- **Date:** 2026-11-23

## Context

The collector produces numbers that people will use to judge whether AI-assisted
work is faster and as good. Those numbers are only credible if the raw records
cannot be quietly changed afterwards, if a mistake can be corrected without
losing what was first recorded, and if a damaged file does not take the whole
history with it.

Several writers produce records: hooks inside agent sessions, the CLI, gates,
and the worktree commands. They run as separate processes, sometimes at once.

## Decision

1. Every record is an `event` (core contract), validated before it is written,
   and appended as one JSON line to `events/<YYYY-MM>/<stream>.jsonl`. Hook
   events go to one stream per session; CLI, gate and worktree records go to
   `_manual`.
2. Nothing is ever rewritten or deleted by the kit. A correction is a new event
   (for example `human adjust`), and reports apply it.
3. Task state is **derived** from the events every time it is needed. There is
   no task state file that could drift from the log.
4. Reading skips lines that are not valid events and counts them; the count is
   shown in reports.
5. Local state that is only an index (the worktree markers that let a hook find
   its task quickly) lives in `state/`, is never exported, and can be rebuilt.

## Alternatives considered

- **A state file per task, updated in place.** Simple to read, but an update
  that fails halfway leaves wrong state, edits leave no trace, and concurrent
  writers overwrite each other.
- **SQLite.** Transactions and queries for free, but it adds a dependency or a
  newer runtime module, and the records become a binary file that ordinary tools
  cannot read or diff.

## Consequences

- Reading cost grows with history, since every command replays the log. This is
  fine for one developer's months of work; a rebuildable cache is planned with
  the lock files (P3).
- Appends from several processes are single small writes; a lock protects
  read-check-write commands such as `task start` from P3 on.
- Reports must explain how corrections were applied, and can, because the
  original events are still there.
