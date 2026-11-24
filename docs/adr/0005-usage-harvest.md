# ADR-0005: Harvest token usage from transcripts into rebuildable files

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

The efficiency score needs the cost side of a task: how many tokens, on which
models, spent by the main session and by each sub-agent. Hooks do not carry token
counts. Claude Code writes them into its transcripts
(`<config>/projects/<encoded cwd>/<session>.jsonl` and
`<session>/subagents/agent-<id>.jsonl`), in a format that is not documented and
changes between versions. The spike found that one API response is written as
several records that repeat the same usage: summing every record gave 703 output
tokens where the true total was 453.

Transcripts also hold everything the kit must not keep: prompts, answers, file
contents, tool output, paths.

## Decision

1. **Harvest is a separate, repeatable step**, not part of the hook: `asdk
   harvest` (and automatically after `task end`) reads transcripts and writes
   `~/.agentic-metrics/usage/<session>.json`, validated against the core `usage`
   contract.
2. **Usage files are derived, not records.** They live outside the append-only
   event log, may be deleted at any time, and are rebuilt from the transcripts.
   The same transcripts always give the same bytes (sorted output, no harvest
   time inside); an unchanged file is not rewritten.
3. **One API response counts once**, keyed by `message.id` + `requestId` (stored
   only as a hash); when copies differ the largest counter wins. Sessions found in
   more than one project folder are merged by the same key.
4. **Only numbers, model names, reasoning effort, ids and times are kept.** Tool
   results become a count and a byte size; a sub-agent's meta file contributes
   its type and model, never its description. Transcripts are found by file name,
   so no path is stored.
5. **Format changes are visible, not silent.** Unused record types are skipped;
   an assistant record without the expected fields, and a line that is not JSON,
   are counted per source, and summaries say the totals are partial. The Claude
   Code version seen in the transcript is kept.
6. **Parsing is Claude-specific, summing is not.** The adapter writes usage files;
   the collector reads any adapter's files.

## Alternatives considered

- **Count tokens in the hook.** Hook payloads have no usage.
- **Store usage as events.** Re-harvesting would then append duplicates or
  require rewriting history; derived numbers do not belong in the record log.
- **Use the headless `--output-format json` result.** Exact, but only for runs
  the kit launches itself; interactive sessions need the transcripts. Sterile runs
  (P7) will use the result instead.

## Consequences

- Usage is only as fresh as the last harvest; `task end` runs one, and reports
  name sessions that were never harvested.
- A session's usage is attributed to a task through hook events that carry the
  task id. Work a sub-agent does in a task worktree while its parent session sits
  in the main checkout is not tied to the task yet; P5 and P7 refine this.
- When Claude Code changes its transcript format, unparsed counts rise and the
  adapter needs an update; the rest of the kit is unaffected.
