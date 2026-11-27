# Experiments

## E1: the same tasks with the ultra, max and pro profiles

**Status:** done. All 42 runs (E1b); then the hidden tests and one reviewer agent
on the commit of every run, instead of the person's review of every run (E1c).

### Question

How much does the plan profile ([ADR-0008](adr/0008-plan-profiles.md)) change
what matters for the 3× goal: how many changes a person still has to look at,
how often the first gate passes, how many defects escape, and how many tokens a
task costs?

### What changed after the runs

The plan was a blind, timed review of all 42 runs by the person. It was dropped
on 2026-11-27, after one pilot review:

- Timing a person on every change measures the cost the kit is meant to remove,
  and the measurement itself needs that cost.
- One person timing themself on tasks they wrote is weak evidence, and nobody
  else can repeat it.
- E1 has no run without the kit, so those minutes would have compared the
  profiles with each other, not the kit with working without it.

The review side now rests on what anyone can run again without a person: each
task's hidden tests on the exact commit of every run, and the reviewer agent of
P8 on the same commit. The count that stands in for review time is how many
changes are left for a person. The 3× goal stays a goal; E1 does not show it.

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
- **Hidden tests:** `e1.mjs check` runs each task's hidden tests on the commit its
  run left, in a throw-away checkout, merged or not. This is the answer key.
- **Reviewer agent:** `e1.mjs agent-review` runs one reviewer on that commit, as
  `asdk review run` does ([ADR-0009](adr/0009-reviewer-agents.md)): sterile, on
  a packet with the brief, the diff, the changed files and the checks recorded
  for the commit; `act_on` findings are proven by their reproduction, and the
  kit checks the brief's scope. A change merged by its run is compared with
  `dev` as it was before the merge. The reviewer is the same for every run
  (the `max` profile's reviewer, sonnet at high effort), so it is not what
  differs between the profiles. Nothing is merged and nothing is recorded in
  the run.
- **Left for a person:** a change the reviewer did not accept, or for which it
  gave no usable verdict.
- **Slips through:** a change the reviewer accepts whose hidden tests fail.
- **A person's review (not used for the results):** `e1.mjs review` still shows
  one run at a time without the profile, times it, and on accept merges and
  runs the hidden tests. Only the first pilot run was reviewed that way. Notes
  on each change, written for that review, stay local and unused.
- **Merge policy in the E1 runs:** the runs were made before P8, with a policy
  where a person's review is the one review every risk level needs. The gate
  follows the effective risk (G1 for low, G2 otherwise), and low-risk changes
  were merged by the run itself.
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
node tools/experiment/e1.mjs status ~/asdk-e1
node tools/experiment/e1.mjs run ~/asdk-e1          # the rest; stops by itself near the quota limit
node tools/experiment/e1.mjs check ~/asdk-e1        # hidden tests on every run's commit
node tools/experiment/e1.mjs agent-review ~/asdk-e1 # one reviewer agent per run; stops near the quota limit too
node tools/experiment/e1.mjs analyze ~/asdk-e1
node tools/experiment/e1.mjs review ~/asdk-e1       # optional: a person's blind, timed review
node tools/experiment/e1.mjs exclude-time ~/asdk-e1 <run> --reason <text>   # a review timer left running
```

`exclude-time` leaves one finished review's minutes (and the kit's human hours and
efficiency for that run) out of the analysis; the decision and its checks still
count, and the reason stays in the experiment log.

`run` and `agent-review` use the Claude Code subscription of whoever runs them;
`--claude <path>` names the executable when it is not on PATH. `agent-review`
takes `--model`, `--effort` and `--no-prove` to try another reviewer; a run that
could not finish is tried again the next time, an answer that is no verdict stays
as a result.

### Limits, known before running

- Twelve tasks, one run per task and profile (three for three tasks with `max`):
  differences of a few minutes or a few percent can be noise.
- The tasks, their estimates and the hidden tests were written by one person,
  with the assistant that builds this kit.
- The tasks are small and on one tiny code base; larger tasks may behave
  differently.
- One machine (Windows), one version of Claude Code, one period of time; models
  and quotas change.
- The hidden tests are one or two tests per task. A change that passes them can
  still be wrong in a way they do not test.
- There is no run without the kit, so E1 compares profiles and measures the
  reviewer; it does not show how much faster work with the kit is.
- "Left for a person" is a count of changes, not minutes.
- One reviewer run per change. The verifier count of the profiles is not tested.
- One run (r03, the first pilot) was reviewed and accepted by the person before
  the plan changed; its timer ran overnight, so its minutes are left out. It is
  counted like the other runs in the tables below.

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
  profiles apart. The tasks were small enough for every profile.
- `pro` costs about a third of `ultra` or `max` per task and takes half the time.
  `ultra` and `max` cost about the same on low and medium tasks; on the two high
  tasks `ultra` cost about 2.7 times as much as `max`.

#### Hidden tests and the reviewer agent (final)

All 42 changes, 2026-11-27, Claude Code 2.1.330 on Windows, kit commit cdc84a7,
reviewer `0f6759901d5d` (reviewer.md), sonnet at high effort, one run per
change, from `node tools/experiment/e1.mjs analyze`.

| | Hidden tests pass | Hidden tests fail |
|---|---|---|
| Reviewer accepts | 42 | 0 |
| Reviewer does not accept | 0 | 0 |
| No usable verdict | 0 | 0 |

| Profile | Runs | Hidden tests pass | Reviewer accepts | Reviewer `act_on` findings | Reviewer `consider` findings |
|---|---|---|---|---|---|
| ultra | 12 | 12 | 12 | 0 | 1 |
| max | 18 | 18 | 18 | 0 | 0 |
| pro | 12 | 12 | 12 | 0 | 2 |

The 42 reviews cost USD 2.56 at list price and took 8.7 minutes in all (median
11 s, longest 28 s); the seven-day quota moved from 16 % to 17 %. No change left
the scope of its brief.

What this shows:

- **The profiles cannot be told apart by quality on these tasks.** Every change
  of every profile passes its hidden tests and is accepted. With the agent side
  above, `pro` did the same work for about a third of the list cost.
- **The reviewer raised no false alarm on real agent work.** On 42 changes that
  pass their hidden tests it gave no `act_on` finding and accepted all of them,
  as it accepted the eight clean changes of the
  [skill regression](../skill-regression/results/).
- **Left for a person by the reviewer: 0 of 42.** Under the kit's default merge
  policy the 8 high-risk changes still need a person's review whatever the
  reviewer says ([ADR-0007](adr/0007-risk-and-merge-policy.md)), so a person
  would look at 8 of 42 instead of 42.

What it does not show:

- **Whether the reviewer catches a bad change made by an agent.** There was none
  among the 42, so nothing could slip through and nothing could be caught. That
  evidence is the skill regression, where every planted defect was found and
  proven; planted defects are not the mistakes agents make on their own.
- **That the 42 accepted changes are right.** They pass one or two hidden tests
  each. The person's one pilot review accepted its change too.
- **Any saving of time.** The count went from 42 to 8, with no minutes behind
  either number and no run without the kit to compare with.

## E2: harder tasks, to see what happens when an agent's change is wrong

**Status:** prepared on 2026-11-27 (E2a): the tasks, the runner and the rules
below. No run has been made. This section was written before any run; what the
pilot changes will be listed under "Changes after the pilot", with reasons.

### Question

1. On tasks with a known way of being left half-done, how often is the change an
   agent makes on its own wrong by the hidden tests, and does the profile change
   that?
2. Of the wrong changes, how many does the reviewer agent hold back, and how
   many does it accept? And how many right changes does it hold back?

E1 could not answer the second question: all 42 of its changes were right, so
the reviewer never met a wrong change that an agent made on its own.

### Design

- **Starting point:** the demo with a base laid over it
  ([tools/experiment/suites/e2/base](../tools/experiment/suites/e2/base/)): due
  dates, list filters, search, a summary, bulk import and a JSON data file, in
  seven source files with tests, and the HTTP contract written out in the README.
  The demo in `examples/` is not changed.
- **Tasks:** eight fictional tasks, DEMO-201 to DEMO-208, in
  [tools/experiment/suites/e2/tasks](../tools/experiment/suites/e2/tasks/): three
  bug fixes, four features and one refactoring; one low, five medium and two
  high by declared risk. They are harder than E1's in ways that can be named:
  a bug with a second code path, a feature that crosses the store, the HTTP
  layer and the data file, a requirement that holds "wherever an item is
  created", a refactoring that has to keep a written contract.
- **Hard for a stated reason:** each task has `naive/`, a half-done version laid
  over the reference solution, with the tests its author would have written. A
  test proves, for every task: the starting point passes G2 and fails the hidden
  tests; the reference solution stays inside the brief's scope and passes both;
  the half-done version stays inside the scope, passes G2, passes some hidden
  tests and fails others. So the visible gate cannot tell half from done, and
  the hidden tests can.
- **Hidden tests follow the brief:** every hidden assertion is something an
  acceptance criterion says, or the README's HTTP contract where a criterion
  points to it. A requirement nobody wrote down is not tested.
- **Runs:** every task with every profile twice: 48 runs, seeded and
  interleaved. Two runs per cell because a wrong change is a matter of chance,
  and one run cannot show a rate.
- **One run:** as in E1, with E1's merge policy. Since 2026-11-27 `wt finish`
  also refuses a change with a file outside the brief's scope; such a run gets
  the one retry a failed gate gets, with the files named. A change still outside
  afterwards is left for a person.
- **Hidden tests and reviewer agent:** as in E1c. `e2.mjs check` runs the hidden
  tests on the commit of every run; `e2.mjs agent-review` runs one reviewer on
  that commit, the reviewer of the `max` profile at the run's effective risk, with proofs
  and the scope check, the same for every profile. Nothing is merged or recorded
  in the run.
- **What is reported:** by profile, how many changes pass their hidden tests;
  the reviewer's decisions against the hidden tests (accepted and right,
  accepted and wrong, held back and wrong, held back and right); list cost and
  time. Counts, with the number of runs beside every one.

| Task | Type | Risk | What the half-done version leaves out | Hours without AI |
|---|---|---|---|---|
| DEMO-201 An item due today is listed as overdue | bugfix | medium | the summary, which decides "overdue" in a second place | 1 |
| DEMO-202 Page the list of items | feature | medium | the total counts every item instead of the filtered ones; `1e2` and an empty value pass as numbers | 2 |
| DEMO-203 Give items a priority and move the data file to version 2 | feature | high | the bulk import, which builds its items itself | 4 |
| DEMO-204 Quick changes can leave an older state in the data file | bugfix | medium | after one failed write nothing is saved again; every change is a write of its own | 2 |
| DEMO-205 Export the list as CSV | feature | medium | a lone carriage return is not quoted; a formula with a comma is not guarded | 2 |
| DEMO-206 Move the routes into a table | refactor | high | `:id` takes anything, so `/todos/007` is item 7 and `GET /todos/import` is an id | 3 |
| DEMO-207 Repeat an item every month | feature | medium | after a short month the series stays on the earlier day: 01-31, 02-28, 03-28 | 4 |
| DEMO-208 Search misses titles when the query has capital letters | bugfix | low | full-width letters and digits still differ from half-width ones | 0.75 |

### Pilot, and what may change after it

`e2.mjs init --pilot` plans a pilot in a folder of its own: every task once with
`pro`, the cheapest profile, eight runs. It shows what a run costs and finds
faults in the tasks. Its runs are never part of the results.

After the pilot a task may be changed for three reasons only, each change
listed here with its reason:

1. a hidden test asserts something no acceptance criterion says;
2. a hidden test does not give the same result every time;
3. a brief can be read in two ways.

A task is not made harder because the agent got it right. If the agents get
everything right again, that is the result and it will be reported as that.
Whether the 48 runs are made after the pilot is the person's decision.

### How to run it

```sh
node tools/experiment/e2.mjs init ~/asdk-e2-pilot --pilot
node tools/experiment/e2.mjs run ~/asdk-e2-pilot
node tools/experiment/e2.mjs check ~/asdk-e2-pilot
node tools/experiment/e2.mjs analyze ~/asdk-e2-pilot

node tools/experiment/e2.mjs init ~/asdk-e2
node tools/experiment/e2.mjs run ~/asdk-e2            # stops by itself near the quota limit
node tools/experiment/e2.mjs check ~/asdk-e2
node tools/experiment/e2.mjs agent-review ~/asdk-e2
node tools/experiment/e2.mjs analyze ~/asdk-e2
```

### Limits, known before running

- Eight tasks and sixteen runs per profile: a rate from sixteen runs is rough,
  and a difference of one or two runs between profiles can be chance.
- The tasks, the hidden tests and the half-done versions were written by one
  person with the assistant that builds this kit. A half-done version shows one
  way to fail; agents may fail in other ways, or not at all.
- The agents under test are models of the same family as that assistant. The
  tasks may be easier, or harder, for them than for another agent.
- The half-done versions are not agent mistakes and are not counted as such. If
  no agent makes a wrong change, the reviewer can only be run on them, which
  measures what skill regression already measures: planted defects.
- The reviewer runs after the fact. A wrong change it holds back is not sent
  back and fixed, so E2 does not show what the whole loop delivers.
- One machine (Windows), one version of Claude Code, one period of time.
- No run without the kit: E2, like E1, does not show how much faster work with
  the kit is.

### Changes after the pilot

None yet: no pilot has been run.
