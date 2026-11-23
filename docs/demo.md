# Demo: DEMO-001 with Claude Code

This walk-through runs the end-to-end slice for real: a sub-agent implements a
small feature in its own worktree, a gate checks the rebased commit, the branch
is merged into `dev`, and the task ends up as a row in the scorecard.

The automated test `test/e2e-demo.test.mjs` runs the same flow with a scripted
agent instead of Claude, so it needs no account and runs in CI.

**Cost:** step 5 uses your Claude Code plan's quota (one sub-agent run on a
small change). Everything else runs locally.

## Before you start

- Node.js 22+, git, and the Claude Code CLI, logged in.
- `asdk` below means `node <path to agentic-sdlc-kit>/bin/asdk.mjs`. Running
  `npm link` in the kit checkout puts an `asdk` command on your PATH instead.
- Records go to `~/.agentic-metrics/` (or `AGENTIC_METRICS_HOME`). They stay on
  your machine.

## 1. Create the demo repository

```sh
node tools/demo-setup.mjs ~/work/demo-api
```

This copies `examples/demo-api` into a new git repository with `main` and
`dev` (`dev` checked out), writes `.claude/settings.local.json` with hooks that
call `asdk hook`, and registers the project as `demo-api`. The kit's own
repository is not changed.

## 2. Start the task

```sh
cd ~/work/demo-api
asdk task start DEMO-001 --type feature --risk low --estimate 6 --title "Add due dates to todo items"
```

`--estimate` is your estimate of the effort **without** AI. It is recorded once
and never edited; it is the baseline of the efficiency score.

## 3. Create the task worktree

```sh
asdk wt new DEMO-001 --slug due-date
```

The worktree is created at `~/wt/demo-api/DEMO-001` on branch
`feat/DEMO-001-due-date`. The local hook settings are copied into it, because
untracked files do not follow a new worktree.

## 4. Open Claude Code in the worktree

```sh
cd ~/wt/demo-api/DEMO-001
claude
```

## 5. Dispatch the implementer

Ask:

> Use the implementer sub-agent to implement briefs/DEMO-001.json.

The implementer (`.claude/agents/implementer.md`) works from the brief only,
changes `src/**` and `test/**`, runs the tests, commits, and replies with an
agent report. Every hook event is recorded as metadata: tool names, sizes,
sub-agent ids. Prompt text, file contents and answers are not stored.

## 6. Gate and merge

```sh
asdk wt finish DEMO-001
```

The branch is rebased onto the latest `dev`, G1 (syntax check and unit tests)
runs on the rebased commit and is recorded on the task, and the branch is merged
with `--no-ff`. If G1 fails, nothing is merged and the worktree stays; fix it
(or ask the agent to) and run `wt finish` again. The first-pass rate in the
report counts that.

## 7. Accept and end

Check the result yourself (run `npm start`, try `GET /todos?overdue=true`),
then record it:

```sh
cd ~/work/demo-api
asdk task verify DEMO-001 --check acceptance --result pass --executor human
asdk task end DEMO-001 --outcome accepted --completed-by ai
```

Use `--completed-by ai_with_human_fixes` if you had to change the code.

## 8. Read the scorecard

```sh
asdk report
```

Open `~/.agentic-metrics/reports/summary.md`. The row is `Partial` with the flag
`no_human_time`: human time is recorded from a later phase on, and until then
the efficiency column stays empty instead of being guessed.

## Clean up

Delete the demo directory and remove the `demo-api` entry from
`~/.agentic-metrics/config.json`. Events stay in `~/.agentic-metrics/events/`;
delete that folder too if you want no trace of the demo.
