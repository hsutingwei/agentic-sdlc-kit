# A real run of the demo

DEMO-001 ([docs/demo.md](demo.md)) run once with Claude Code instead of the
simulated agent used by the tests, to check that real hooks, a real sub-agent and
real transcripts produce the records the kit expects.

- **Date:** 2026-11-24
- **Claude Code:** 2.1.330, native install, Windows 10
- **How:** headless (`claude -p … --model sonnet --output-format stream-json
  --verbose --permission-mode acceptEdits`, tools limited to Read, Edit, Write,
  Glob, Grep, Agent, `node` and `git`), started inside the task worktree. The demo
  repository, the worktree root and the metrics directory were in a throw-away
  folder whose path contains CJK characters and spaces.
- **Prompt:** "Use the implementer sub-agent to implement briefs/DEMO-001.json.
  Wait until it has finished, then reply with its agent report."

## What happened

| Step | Result |
|---|---|
| `demo-setup`, `task start --estimate 6`, `wt new` | ok |
| Claude Code run | 2 turns, 38.8 s; one `implementer` sub-agent (Sonnet), completed. The run reported this sub-agent as requested in the foreground; the spike's run had started one in the background (finding 6). The kit counts both the same way. |
| Changes | One commit, `feat: Add due dates to todo items (DEMO-001)`, touching only the allowed paths: `src/todos.mjs`, `src/server.mjs`, `test/todos.test.mjs` (+71 −7 lines, tests added for the criteria) |
| `wt finish` | Rebased onto `dev`, G1 (syntax check, unit tests) **passed on the first run**, merged with `--no-ff`, worktree and branch removed |
| Hooks | 34 events, every one tagged with DEMO-001 through the worktree marker: SessionStart 1, UserPromptSubmit 1, PreToolUse 14, PostToolUse 14, SubagentStart 1, SubagentStop 1, Stop 1, SessionEnd 1. No content was stored. |
| `harvest` | 9 API responses (2 main session, 7 implementer), 0 unreadable records; 5,685 output tokens, 28,986 cache writes, 114,557 cache reads, all on Sonnet |
| `quota snapshot --stdin` (the run's stream-json) | `seven_day` 15%, with its reset time |
| `report --harvest` | AI time 0.01 h (the 39 s run), 1 check, first pass yes, 1 sub-agent, tokens as above |

The run cost USD 0.16 at API list prices according to Claude Code's own result;
on a subscription it only used quota.

## What the row says, and why it is `Missing`

The report grades the row `Missing` with `no_human_time` and `open_task`. That is
correct: nobody timed any human work, and the acceptance check and `task end
--outcome accepted` are a person's decision, which an automated run must not make
for them. Following [docs/demo.md](demo.md) interactively adds both, and the row
becomes `Complete` with an efficiency.

## What this run confirmed

- The hook command (absolute node path, quoted CJK path) works when Claude Code
  starts it from a worktree, and the environment reaches the hook: events went to
  the run's own metrics directory, nothing to the user's.
- Events carry the task id without any setup beyond `wt new`.
- Transcript harvesting finds the session and its sub-agent by file name, and the
  numbers split cleanly into main session and implementer.
- `rate_limit_event` from stream-json becomes a quota snapshot.
- The gate ran on the rebased commit and the merged tree is the tree it verified.

## Not covered by this run

- Interactive use, human timing and acceptance (see above).
- A failing first check, escalations, blocks: covered by the tests and the
  [sample report](../examples/sample-report/), not by this run.
- Hooks installed at user level (this run used the demo's local settings).
