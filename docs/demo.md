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
`dev` (`dev` checked out), installs the hooks in that repository's
`.claude/settings.local.json` (your `~/.claude` is not touched), and registers
the project as `demo-api`. The kit's own repository is not changed. Check the
setup with:

```sh
asdk health --scope local --project ~/work/demo-api
```

`last hook event` stays a warning until Claude Code has run in the project.

## 2. Start the task

```sh
cd ~/work/demo-api
asdk task start DEMO-001 --type feature --risk low --estimate 6 --title "Add due dates to todo items"
```

`--estimate` is your estimate of the effort **without** AI. It is recorded once
and never edited; it is the baseline of the efficiency score.

Time yourself whenever you work on the task; your hours are the other half of
the score:

```sh
asdk human start DEMO-001 --activity spec    # spec, review, fix, acceptance or other
asdk human stop
```

Forgot the timer? `asdk human adjust DEMO-001 --minutes 15 --reason "..."` adds a
correction; nothing recorded is overwritten.

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

## 6. Gate, review and merge

```sh
asdk wt finish DEMO-001
```

The branch is rebased onto the latest `dev`. DEMO-001 was declared low risk,
but it changes `src/server.mjs`, which `.asdk/risk-paths.json` marks as the
public HTTP contract, so its effective risk is **medium**. The merge policy in
`.asdk/gates.json` then asks for G2 (syntax, agent references, deny rules, unit
and integration tests) on the rebased commit, and one review of that commit
([ADR-0007](adr/0007-risk-and-merge-policy.md)).

If G2 fails, nothing is merged and the worktree stays; fix it (or ask the agent
to) and run `wt finish` again. The first-pass rate in the report counts that.

When G2 passes, `wt finish` stops and prints the commit to review. Look at the
diff, timing it, and record your verdict on that exact commit:

```sh
asdk human start DEMO-001 --activity review
git -C ~/wt/demo-api/DEMO-001 diff dev...HEAD
asdk human stop
asdk task verify DEMO-001 --check review --result pass --executor human --sha <the commit wt finish printed>
asdk wt finish DEMO-001
```

The second `wt finish` gates the same commit again and merges it with `--no-ff`.
A reviewer agent can record the review instead (`--executor agent`); reviewer
agents come in a later phase.

## 7. Accept and end

Check the result yourself (run `npm start`, try `GET /todos?overdue=true`),
timing it, then record it:

```sh
cd ~/work/demo-api
asdk human start DEMO-001 --activity acceptance
# ... check ...
asdk human stop
asdk task verify DEMO-001 --check acceptance --result pass --executor human
asdk task end DEMO-001 --outcome accepted --completed-by ai
```

Use `--completed-by ai_with_human_fixes` if you had to change the code.

`task end` also harvests the token usage of the task's sessions from Claude
Code's transcripts. See it with:

```sh
asdk usage --task DEMO-001
```

To record how much quota the run used, copy the percentages from `/usage` in
Claude Code:

```sh
asdk quota snapshot --window five_hour=12 --window seven_day=40 --plan max-5x
```

## 8. Read the scorecard

```sh
asdk report --harvest
```

Open `~/.agentic-metrics/reports/summary.md` (the CSV files are next to it). With
your time recorded and the session harvested the row is `Complete`, and its
efficiency is the estimate divided by your hours times the quality factor; a
failed first G2 run costs 0.1. See [metrics.md](metrics.md) for every column
and flag, and [demo-run.md](demo-run.md) for the numbers of a real run.

## Clean up

Delete the demo directory and remove the `demo-api` entry from
`~/.agentic-metrics/config.json`. Events stay in `~/.agentic-metrics/events/`;
delete that folder too if you want no trace of the demo.
