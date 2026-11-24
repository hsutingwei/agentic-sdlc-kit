# Metrics

What `asdk report` measures, how, and what it cannot measure. Every number comes
from recorded events and harvested usage; nothing is estimated to fill a gap.
An example built from fictional data is in
[examples/sample-report](../examples/sample-report/).

## Per task (`tasks.csv`)

| Column | Definition |
|---|---|
| `profile` | Plan profile the task was started with (`task start --profile`, or taken from the current plan). Empty when no plan was known. |
| `lead_time_h` | `task start` to `task end`, wall-clock hours. Empty while the task is open. |
| `ai_h` | Hours an agent was working on the task: turns (prompt to `Stop`) and sub-agents (`SubagentStart` to `SubagentStop`) of the sessions that recorded events of the task, merged so overlapping time counts once, and clipped to the task window. A turn crossing the window's edge is cut, not dropped. |
| `human_h` | Hours a person recorded with `asdk human start/stop`, plus adjustments. One timer runs at a time. |
| `human_<activity>_h` | The same, per activity: `spec`, `review`, `fix`, `acceptance`, `other`. |
| `waiting_human_h` | Hours the task was blocked with `--waiting-on human`, inside the task window. |
| `blocked_h` | Hours blocked for any reason. |
| `estimate_h` | The estimate **without AI**, recorded once at `task start` and never edited. |
| `efficiency_raw` | `estimate_h / human_h` for accepted tasks; 0 for rejected and abandoned ones. |
| `quality` | Quality factor, see below. |
| `efficiency` | `efficiency_raw × quality`. |
| `verifications` | Checks recorded (gates and humans). |
| `first_pass` | Whether the first recorded check passed. |
| `escalations` | `task escalate` records: takeover, repeated failure, risk decision. |
| `escaped_defects` | Later tasks that name this one with `--fixes`. |
| `gate_runs`, `sessions`, `subagents` | Counts. |
| `input_tokens` … `cache_read_tokens` | Tokens of the task's sessions with a timestamp inside the task window, from harvested usage (one count per API response). |
| `data_quality`, `flags` | See below. |

## Quality factor and efficiency ([ADR-0006](adr/0006-efficiency-score.md))

```
quality = 1
        - 0.1  if the first check failed (rework)
        - 0.1  per escalation, at most 0.3
        - 0.3  if a later task fixes an escaped defect (--fixes)
        never below 0.5
```

The weights can be changed in `~/.agentic-metrics/config.json` under `scoring`
(`not_first_pass`, `per_escalation`, `escalation_cap`, `escaped_defect`,
`floor`, each from 0 to 1).

**Headline efficiency** in `summary.md`:

```
Σ (estimate_h × quality) of accepted Complete tasks
──────────────────────────────────────────────────
Σ human_h of all Complete tasks (accepted, rejected, abandoned)
```

Rejected and abandoned work costs its hours and earns nothing, so the headline
cannot be raised by leaving failures out. Deferred and open tasks are not scored.

## Data quality

| Grade | Meaning | Flags |
|---|---|---|
| `Complete` | Every input was recorded. Only these count in the headline. | none |
| `Partial` | A score is shown, but something is doubtful. | `no_verification`, `no_ai_activity`, `unpaired_turns`, `concurrent_sessions`, `usage_not_harvested`, `usage_unreadable_records`, `long_human_session`, `human_timer_auto_stopped`, `unpaired_human_stop`, `overlapping_human_timer`, `clock_went_back`, `duplicate_task_start`, `duplicate_task_end`, `unexpected_block`, `unexpected_resume` |
| `Missing` | No score is possible. | `open_task`, `deferred`, `no_estimate`, `no_human_time`, `open_human_timer`, `no_task_start` |

`summary.md` explains every flag it uses and lists the tasks that carry it.

## Other reports

- **`verifications.csv`** – one row per check: task, time, check, result,
  executor, gate, commit. Checks are `build`, `unit`, `integration`, `ui`,
  `review` and `acceptance`; executors are `script`, `agent` and `human`. A review
  is always bound to a commit, and acceptance is always recorded by a human.
  `evidence` is the SHA-256 of the evidence file of an `asdk verify run --record`;
  the file itself stays in `~/.agentic-metrics/evidence/`.
- **`usage.csv`** – tokens per task and model, plus `(outside tasks)` per model.
- **Task coverage** (`summary.md`) – share of output tokens of all harvested
  sessions that fell inside a task window. Output tokens are used because they
  reflect work done; cache reads, which dominate raw counts, would hide it.
- **Push check** (`asdk push-check`) – each first-parent commit of the main
  branch as `pass`, `after_push`, `failed` or `missing` against the configured
  gate's runs on that SHA. Push times come from the pre-push hook, or
  approximately (whole seconds, time of the local update) from the reflog.

## Privacy

Only metadata is recorded: event and tool names, sizes, counts, ids, times. No
prompt text, file contents, tool output or paths. Strings listed in
`config.json` under `privacy.mask` are replaced with `[masked]` in every report
file, case-insensitively.

## What is not measured

- **The estimate is a human guess.** People tend to over- or under-estimate the
  work without AI; the score inherits that bias. It is recorded before the work
  and never edited, which removes hindsight but not optimism.
- **Human time is only what was timed.** Thinking about a task away from the
  keyboard, or time not entered, is missing. Adjustments help but rely on memory.
- **AI time comes from hooks.** Sessions without the hooks, and sub-agents a
  session in the main checkout sends into a task worktree, are not tied to the
  task (its events carry no task id). Run Claude Code inside the task worktree.
- **Tokens need transcripts.** Sessions whose transcripts were deleted cannot be
  harvested (`usage_not_harvested`). Headless runs with `--no-session-persistence`
  leave none; the kit will take their usage from the JSON result (P7).
- **Quota is sampled.** Snapshots are as fresh as the last `quota snapshot`.
- **Quality is coarse.** First pass, escalations and escaped defects are signals,
  not a review of the code. A defect found without a `--fixes` task is invisible.
- **Clocks.** Processes can disagree by milliseconds; derivations tolerate that
  (ADR-0004) but nothing finer is meaningful.
