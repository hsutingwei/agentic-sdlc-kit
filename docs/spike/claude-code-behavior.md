# Spike: Claude Code behaviour the kit depends on

- **Date:** 2026-11-23
- **Claude Code:** 2.1.330, native install, Windows 10, PowerShell 5.1
- **Auth:** subscription login (`apiKeySource: none`), no API key
- **Method:** a throw-away project with a `CLAUDE.md` containing a canary word, a
  `data.txt`, a sub-agent definition (`tools: Read`, `model: haiku`) and project
  hooks for eight events that log only the *shape* of each payload. Runs used
  `--model haiku`. Four runs in total; the most expensive cost about USD 0.004 at
  list price.

Everything below was observed in these runs unless marked *not tested*. Claude
Code changes quickly; the adapter must re-check these points when its minimum
version moves.

## Findings and what they mean for the kit

### 1. A Claude Code session leaks its environment into child `claude` runs

A process started from inside a Claude Code session sees variables such as
`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_SIMPLE` (which is the
`--bare` switch) and `ANTHROPIC_BASE_URL`. A child `claude` that inherits them
does not behave like one started from a terminal. The spike removed every
`CLAUDE*` and `ANTHROPIC*` variable before each run; the inherited case was
*not tested*.

**Kit:** the adapter launches every headless run with a scrubbed environment.

### 2. `CLAUDE.md` under Claude Code's own temp directory was not loaded

The same project loaded `CLAUDE.md` from an ordinary temp folder but not from
the session's scratch directory under Claude Code's temp folder. This is not
documented.

**Kit:** never rely on it. Test and spike projects that need `CLAUDE.md` live
outside Claude Code's temp folder; sterile runs disable it explicitly instead.

### 3. Headless JSON output carries usage and cost per model

`-p --output-format json` returns `usage`, `modelUsage` keyed by model id (with
input, output, cache and `costUSD`), `total_cost_usd`, `num_turns`,
`duration_ms`, `terminal_reason` and `subagent_stats` (spawned, completed,
started in background, refusals by limit).

**Kit:** sterile runs record their usage from this result; no transcript needed.

### 4. `--safe-mode --no-session-persistence` gives a sterile run on a subscription

With `--safe-mode --no-session-persistence --tools Read --strict-mcp-config`:
`CLAUDE.md` was not loaded (the canary was not known), no hook fired, and no
transcript was written. The control run without these flags loaded the canary,
fired hooks and wrote a transcript. Authentication used the subscription login.

**Kit:** isolation level `sterile` maps to these flags, run from a directory
outside the repository. Because hooks do not fire, the collector takes usage
from the JSON result (finding 3).

### 5. Hooks: which fields arrive, and which must never be stored

Project hooks in `.claude/settings.json` fired in headless mode. Fields seen:

| Event | Fields |
|---|---|
| `SessionStart` | `session_id`, `transcript_path`, `cwd`, `source` |
| `UserPromptSubmit` | + `prompt_id`, `permission_mode`, **`prompt`** |
| `PreToolUse` | + `tool_name`, **`tool_input`**, `tool_use_id`, `effort` |
| `PostToolUse` | + **`tool_response`**, `duration_ms` |
| `SubagentStart` | `agent_id`, `agent_type` |
| `SubagentStop` | + `agent_transcript_path`, **`last_assistant_message`** |
| `Stop` | + **`last_assistant_message`**, `stop_hook_active` |
| `SessionEnd` | `reason` |

- Tool calls made **inside** a sub-agent carry `agent_id` and `agent_type`, and
  the **parent's** `session_id`.
- `PreToolUse` with `tool_name: Agent` fires before a sub-agent is spawned.
- The fields in bold hold prompt text, file contents or answers. For `Read`,
  `tool_response` is an object holding the file.

**Kit:** the hook adapter copies an allowlist of fields and records only sizes
and counts for the bold ones. `PreToolUse` on `Agent` is the hook point for the
dispatch guard.

### 6. Sub-agents ran in the background by default

The sub-agent was started in the background. The parent's first turn ended
("still running") before the sub-agent finished. Its completion arrived as a
new turn (a second `UserPromptSubmit`, `Stop` and `result`).

**Kit:** a turn that ends while sub-agents run is normal, not an unpaired turn.
Lead time and AI time use `SubagentStop`, and a task is not idle while any of
its sub-agents is running.

### 7. Transcripts: where they are and how to count tokens

- Main session: `~/.claude/projects/<encoded cwd>/<session>.jsonl`.
- Sub-agent: `<session>/subagents/agent-<id>.jsonl`, plus `agent-<id>.meta.json`
  (`agentType`, `model`, `spawnDepth`, `finished`, …).
- Assistant records carry `message.model`, `message.usage` and `requestId`.
  Sub-agent records also carry `agentId` and `isSidechain: true`.
- **One API response is written as several records that share `message.id` and
  `requestId`, each repeating the usage.** Summing every record gave 703 output
  tokens where the de-duplicated total was 453 (main session), and 699 versus
  392 (sub-agent).
- The main transcript does not include the sub-agent's usage.
- Transcripts contain many other record types (attachments, request blobs,
  cost state, …).

**Kit:** harvest de-duplicates on `(message.id, requestId)`, sums main and
sub-agent transcripts, attributes usage by model and agent type, and ignores
record types it does not know. Unknown shapes make a row `Partial`.

### 8. Quota usage is machine-readable, but only in stream-json

`--output-format stream-json --verbose` emitted a `rate_limit_event` with
`rate_limit_info`: `status`, `resetsAt` (Unix seconds), `rateLimitType`, and
`unifiedWindows` with a `utilization` between 0 and 1 per window (a
`seven_day` window in this run). Transcripts contained no rate-limit data.

A follow-up run (2026-11-24, `--safe-mode --no-session-persistence`) confirmed
the structure: `unifiedWindows` is an object keyed by window name, each entry
holding `utilization` (0 to 1), `resetsAt` (Unix seconds) and `status`. The
event also carries overage fields, which the kit drops.

**Kit:** headless runs the kit launches record a quota snapshot from this event
automatically. Interactive sessions still need `task snapshot` (manual or from
stdin). Whether a five-hour window appears, and whether the status line receives
this data, were *not tested*.

### 9. A normal run is not a clean context

In the normal run, account-level MCP server instructions were attached to the
sub-agent's context, and the model mentioned them in its answer although the
task did not involve them.

**Kit:** isolation level `fresh` (a sub-agent) still carries account-level
instructions. Testers and reviewers whose results feed a score must run
`sterile` (finding 4).

### 10. Follow-up run (2026-11-24): failures, shells and CJK paths

One more headless run (`--model haiku`, about USD 0.003) from a project whose
path and hook script path both contain CJK characters and spaces. The hook
command was `"<absolute node.exe>" "<absolute script>" <event>`, forward
slashes, quoted.

- Every hook fired. On Windows the command ran in **Git Bash** (`SHELL` was
  `bash.exe`, `MSYSTEM` `MINGW64`). The documentation says PowerShell is used
  when Git Bash is not installed and a per-hook `shell` field exists; neither
  was tested.
- Reading a missing file fired **`PostToolUseFailure`** instead of
  `PostToolUse`, with `tool_name`, `tool_input`, `tool_use_id`, **`error`**
  (the message, which names the path), `is_interrupt` and `duration_ms`.
- Tool and stop events also carried `effort` (`{ "level": "medium" }`); `Stop`
  carried `background_tasks` and `session_crons` arrays.
- In a first attempt the hook script had a syntax error: the hook exited
  non-zero, Claude Code printed the error and the session still finished
  normally.
- Not tested: whether `CLAUDE_CONFIG_DIR` moves the user settings file. The
  settings documentation says settings are stored there; testing it needs a
  logged-in config directory, so the kit relies on the documentation.

**Kit:** the hook also listens to `PostToolUseFailure` and keeps only the size
of `error`; it records `effort.level`. Hook commands use an absolute node path.

## Open questions

- Behaviour when a child run inherits the host session's environment (finding 1).
- Whether the status line or another interactive surface exposes `rate_limit_info`.
- Which windows `unifiedWindows` lists for other plans and usage levels.
- Whether a foreground sub-agent can be requested per call, and how that changes
  finding 6. The real demo run ([demo-run.md](../demo-run.md)) reported its
  sub-agent as requested in the foreground, so both modes occur; the kit treats
  them alike.
