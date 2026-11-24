# ADR-0004: Lock files around read -> check -> write, and file order within a stream

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

Records are appended, never rewritten ([ADR-0002](0002-append-only-events.md)),
but many commands first *check* the log and then append: a task may be started
only once, a human timer may run on one task at a time, `config.json` is read,
changed and written back. Two processes doing that at once can both pass the
check. Sub-agents, scripts and people run commands in parallel, so this is not
hypothetical: the contention tests reproduce each race with locking switched off.

The spec asks for stale-lock handling, giving up after a timeout, and never
replacing damaged state with an empty one.

## Decision

1. **One lock file per resource** under `~/.agentic-metrics/locks/`: `tasks`,
   `config`, `recording`, `claude-settings`. Each check-and-write step holds its
   lock; a step called from another step that holds the same lock in the same
   process reuses it. Hooks take no lock: they only append and never check.
2. **Exclusive create.** A lock is a file opened with the exclusive flag, which
   only one process can do on every supported OS. It holds the pid, the time and
   a random token; release removes it only if the token is still its own.
3. **Stale means old *and* dead.** A lock older than 30 s whose process no longer
   exists may be taken over. A live holder is never interrupted, however long it
   runs. Taking over happens under a short guard lock and only after re-reading
   that the lock is unchanged, so two waiters cannot both take it.
4. **Give up after 10 s** with a message that names the holding process and the
   lock file.
5. **Windows deletes lazily.** A file another process is deleting can keep its
   name for a moment; opening it then fails with EPERM, not EEXIST. That is
   treated as "still held, retry".
6. **Damaged state is never replaced.** `config.json`, the hooks install record
   and settings files that cannot be parsed are refused. A damaged line in the
   manual event stream, which holds every task record, stops task changes until
   it is repaired, because it could hide a start or an end that a check needs.
7. **Within a stream, file order is the true order.** Timestamps from different
   processes were seen 1–2 ms out of step on Windows, enough to put a timer stop
   before its start when sorting by time. Readers merge streams by time but keep
   each stream's own line order; a line is never placed before the one appended
   ahead of it. Across streams only time orders events, so nothing depends on
   that order to the millisecond: hook events attach to their task wherever they
   sort, and a timer stop up to five seconds "before" its start counts as zero.

## Alternatives considered

- **No locks; detect conflicts afterwards.** Duplicate starts would only be
  flagged later, and a lost `config.json` update cannot be detected at all.
- **One global lock.** Simpler, but a long `hooks install` would block task
  commands for no reason.
- **`mkdir` as the lock.** Also atomic, but a directory cannot carry the
  owner's details as simply, and stale detection then depends on timestamps
  alone.
- **OS file locking (`flock`, `LockFileEx`).** Not available from Node's built-in
  modules without native code.

## Consequences

- Concurrent commands queue for at most 10 s; a lock left by a crashed process
  costs at most 30 s once.
- Pid reuse could make a dead holder look alive; the lock then times out with a
  message telling the user which file to delete.
- An event appended with a time earlier than the line before it in the same
  stream is ordered after that line. Records about the past therefore carry the
  time they refer to in their data and keep `ts` as the time of writing: a plan
  change stores `effective_at`, which may be backdated but not before the
  previous plan change.
