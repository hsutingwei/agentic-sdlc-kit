# Experiments

## E1: the same tasks with the ultra, max and pro profiles

**Status:** all 42 runs done (E1b); the reviews are under way. The agent side
of the results is below; the review side follows when every run is reviewed (E1c).

### Question

How much does the plan profile ([ADR-0008](adr/0008-plan-profiles.md)) change
what matters for the 3× goal: the minutes a person spends reviewing, how often
the first gate passes, how many defects escape, and how many tokens a task
costs?

### Design

- **Tasks:** twelve small fictional tasks on `examples/demo-api`, DEMO-101 to
  DEMO-112, in [tools/experiment/tasks](../tools/experiment/tasks/). Six
  features, four bug fixes (each starts from a planted bug) and two refactors;
  by effective risk five low, five medium and two high. Each task has the brief
  the agent sees, hidden tests it never sees, and a reference solution. A test
  proves every task fair: its starting point passes G2, its hidden tests fail
  there, and the reference solution stays inside the allowed paths and passes
  both.
- **Runs:** every task once with each profile (36), plus two extra runs of
  DEMO-101, DEMO-108 and DEMO-112 with `max` to see how much one setting varies
  (6): 42 runs. The order is seeded and interleaves the profiles. The first three
  runs are a pilot (DEMO-102 with each profile), after which the cost of the rest
  is estimated and the run continues only on request.
- **One run:** a fresh demo repository with its own worktree root and metrics
  folder; the task's starting point; `quota plan-change` to the profile's plan;
  `profile apply` for the implementer; `task start --profile` with the estimate;
  `wt new`; then `claude -p` in the worktree with the planner's model and effort,
  `acceptEdits` and the tools Read, Edit, Write, Glob, Grep, Agent and
  `node`, `git`, `asdk` in Bash. The caller's `CLAUDE_CODE_*`, `ANTHROPIC_*` and
  `AGENTIC_*` settings are removed, and `--setting-sources project,local` with
  `--strict-mcp-config` keeps the person's own Claude Code settings and MCP servers
  out; the demo's agents, skills and hooks still load. Each run records the
  Claude Code version and the kit commit. A failed gate gets one retry with its
  output; a second failure is an escalation.
- **Review:** every run, merged or not, is reviewed by the person, one at a time,
  in an order of its own and without the profile. The kit's human timer measures
  it from the moment the change is shown. Accept records a review and the
  acceptance on the exact commit, merges if needed and runs the hidden tests;
  reject ends the task as rejected.
- **Review notes:** before each review, Claude (the assistant that builds this
  kit, not one of the profiles) writes a short note on the change: what changed,
  each acceptance criterion, and anything worth a look. The note never names the
  profile; the person decides. Decided after the first pilot review, so the review
  minutes measure a person reading such a note and the change. That is close to
  the reviewer agents planned for P8, and E1 has no unassisted baseline.
- **Escaped defect:** an accepted change whose hidden tests fail after the merge.
- **Merge policy in E1:** reviewer agents arrive in P8, so the person's review is
  the one review every risk level needs. The gate still follows the effective
  risk (G1 for low, G2 otherwise); the number of verifiers does not.
- **Quota:** each run's stream-json gives the quota windows; runs stop starting
  when the five-hour window reaches 80 % or the seven-day window 90 %, and the
  plan continues where it stopped.
- **Data:** everything stays in the experiment folder, not in
  `~/.agentic-metrics`. Only the files in its `analysis/` folder (numbers, ids,
  names) are copied here. Prompts, answers, code and review notes stay local.

### Estimates without AI

Recorded at task start and never edited afterwards; adjust them in each
`brief.json` before the first run.

| Task | Type | Risk | Estimate (h) |
|---|---|---|---|
| DEMO-101 Add a priority to todo items | feature | low | 1.5 |
| DEMO-102 Filter the list by done | feature | medium | 1 |
| DEMO-103 Tag todo items | feature | low | 2 |
| DEMO-104 Search todo titles | feature | medium | 1.5 |
| DEMO-105 Toggle an item done with one request | feature | medium | 1 |
| DEMO-106 Turn the store into a class | refactor | low | 2.5 |
| DEMO-107 Trim titles changed with PATCH | bugfix | low | 0.75 |
| DEMO-108 Deleting an unknown item must answer 404 | bugfix | medium | 0.75 |
| DEMO-109 New items overwrite existing ones after a delete | bugfix | low | 1 |
| DEMO-110 Creating an item must answer 201 with its location | bugfix | medium | 0.5 |
| DEMO-111 Move the JSON helpers out of the server | refactor | high | 2 |
| DEMO-112 Refuse oversized and non-JSON request bodies properly | feature | high | 3 |

### How to run it

```sh
node tools/experiment/e1.mjs init ~/asdk-e1
node tools/experiment/e1.mjs run ~/asdk-e1 --pilot
node tools/experiment/e1.mjs review ~/asdk-e1
node tools/experiment/e1.mjs status ~/asdk-e1
node tools/experiment/e1.mjs run ~/asdk-e1          # the rest; stops by itself near the quota limit
node tools/experiment/e1.mjs analyze ~/asdk-e1
node tools/experiment/e1.mjs exclude-time ~/asdk-e1 <run> --reason <text>   # a review timer left running
```

`exclude-time` leaves one finished review's minutes (and the kit's human hours and
efficiency for that run) out of the analysis; the decision and its checks still
count, and the reason stays in the experiment log.

`run` uses the Claude Code subscription of whoever runs it; `--claude <path>`
names the executable when it is not on PATH.

### Limits, known before running

- Twelve tasks, one run per task and profile (three for three tasks with `max`):
  differences of a few minutes or a few percent can be noise.
- The tasks, their estimates and the hidden tests were written by the same
  person who reviews the runs.
- The review is blind to the profile, but style can give a model away.
- The tasks are small and on one tiny code base; larger tasks may behave
  differently.
- One machine (Windows), one version of Claude Code, one period of time; models
  and quotas change.
- The verifier count of the profiles is not tested (no reviewer agents yet).
- Reviews are assisted by a note on each change (see Review notes), so the review
  minutes are not those of a person reading the change alone.
- The timer of the first pilot review (r03) ran overnight before the decision was
  recorded; its review minutes are left out of the analysis.

### Results

#### Agent side (final)

All 42 runs, November 2026, Claude Code 2.1.330 on Windows, kit commit 2837bf2
(39 runs are marked dirty because an edit of this page was not yet committed; no
code differed). Cost is the API list
price the stream reports; the runs used a subscription, so they cost quota, not
money. `max` has 18 runs because of the repeats (three tasks, two extra runs each).

| Profile | Runs | First gate passed | Retries | List cost USD (median / total) | Agent time (median / total) | Turns (median) | Output tokens (median) | Models |
|---|---|---|---|---|---|---|---|---|
| ultra | 12 | 12 | 0 | 0.57 / 10.72 | 167 s / 52 min | 3 | 13,080 | opus + haiku in all 12 |
| max | 18 | 18 | 0 | 0.54 / 10.63 | 151 s / 51 min | 3 | 13,036 | opus + haiku in all 18 |
| pro | 12 | 12 | 0 | 0.20 / 3.44 | 78 s / 19 min | 2 | 8,854 | sonnet + haiku in 10, opus + haiku in the 2 high-risk runs |

Median list cost by declared risk:

| Profile | Low | Medium | High |
|---|---|---|---|
| ultra | 0.53 (5) | 0.48 (5) | 2.61 (2) |
| max | 0.55 (7) | 0.45 (7) | 0.97 (4) |
| pro | 0.19 (5) | 0.19 (5) | 0.73 (2) |

The 42 runs moved the seven-day quota from 17 % to 20 %; no five-hour window was
reported. Haiku appears in every run because Claude Code uses it for its own small
tasks.

What this already shows:

- Every run passed its first gate, so in E1 the first-pass rate cannot tell the
  profiles apart. The tasks were small enough for every profile; the comparison
  rests on the review side.
- `pro` costs about a third of `ultra` or `max` per task and takes half the time.
  `ultra` and `max` cost about the same on low and medium tasks; on the two high
  tasks `ultra` cost about 2.7 times as much as `max`.

#### Review side

Not yet: review minutes, accepted and rejected changes, escaped defects (hidden
tests after the merge) and the efficiency score per profile, from
`node tools/experiment/e1.mjs analyze`.
