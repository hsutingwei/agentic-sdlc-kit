# Changelog

All notable changes. Versions follow [Semantic Versioning](https://semver.org/);
until 1.0 the command line and file formats may still change.

## Unreleased

### Experiment E2, prepared (E2a)

- `tools/experiment/suites/e2/`: a larger starting point laid over the demo and
  eight harder fictional tasks, DEMO-201 to DEMO-208. Each has a half-done
  version that a test proves to pass the gates and fail hidden tests
  ([experiments.md](docs/experiments.md)).
- `tools/experiment/e2.mjs`: every task with every profile twice; `init --pilot`
  plans a pilot in a folder of its own. The commands are shared with `e1.mjs`
  through `lib/cli.mjs`; an experiment folder belongs to one suite.
- A run that `wt finish` refuses for scope gets the one retry a failed gate
  gets, with the files named; runs record `first_scope` and `outside_scope`.

### Scope in the merge gate

- `asdk wt finish` does not merge a change with a file outside the `scope` of
  the task's brief, whatever the risk. The brief is read from the integration
  branch, so a branch cannot widen its own scope. A person's passing review of
  that exact commit clears it; an agent's review does not. A task without a
  brief on the integration branch is merged as before, with a line saying the
  scope was not checked.
- The `wt.finish` event carries `scope_checked` and `outside_scope`.

### E1 results without a person's review (E1c)

- `e1.mjs check`: each task's hidden tests on the commit its run left, merged
  or not, without merging anything.
- `e1.mjs agent-review`: one sterile reviewer agent per run, the same for every
  profile, with proofs and the scope check; numbers go to the experiment log,
  the answer stays in the run folder.
- `e1.mjs analyze` has a row for every finished run and sets the reviewer's
  decisions against the hidden tests: changes left for a person, changes that
  would slip through. The person's timed review of every run is no longer part
  of the experiment ([experiments.md](docs/experiments.md) says why).

### Skill regression (P8b)

- `skill-regression/`: eight fictional cases with fifteen planted defects, each
  proven fair by `npm test`, and `regress.mjs prepare|run|score|compare` to
  measure the reviewer and catch what got worse against a baseline.
- Sterile runs read stream-json and refuse to count when Claude Code loaded more
  than the Read tool or any MCP server; their quota windows are recorded.
- A reproduction also proves a finding when the code under test throws.
- The kit checks a reviewed change against the brief's `scope`: a changed file
  outside it is a proven finding, the kit's own when no reviewer names it, so
  an accept cannot let it through. Scores count what only the kit found apart.
- The clean R01 and R06 changes now match their briefs, as the first baseline
  showed they did not; `baseline.json` holds the first sonnet baseline.

### Reviewer agents (P8a)

- `asdk review run --task <ID>`: the profile's reviewers run sterile on the
  exact commit of the task worktree, one independent run per verifier; each
  verdict follows the new `review-verdict` contract and is recorded as an agent
  review (only `accept` passes) ([ADR-0009](docs/adr/0009-reviewer-agents.md)).
- `act_on` findings are proven by running the reproduction the reviewer gives;
  an unproven one is shown as `consider`.
- `asdk review show|list`; `.asdk/review.json` for the notes' language and
  proving; reviewer tokens count for the task in reports.

### Experiment E1, run (E1b)

- All 42 runs done; agent-side results in [experiments.md](docs/experiments.md).
- The review screen shortens very long lines; `e1 exclude-time` leaves a review
  timer that ran on out of the analysis.

### Experiment E1, prepared (E1a)

- `tools/experiment/`: twelve fictional tasks with hidden tests and reference
  solutions, a seeded run plan, a runner that drives headless Claude Code with a
  profile, a blind and timed review, and an analysis into CSV and tables
  ([experiments.md](docs/experiments.md)).
- A kit rule against invisible byte order marks in source, after sixteen were
  found and replaced by the escape.

### Governance (P6a)

- Templates: `AGENTS.md` (safety boundaries, plan before editing, verification
  by risk, report format), `CLAUDE.md` importing it, and `settings.json` deny
  rules, applied to `examples/demo-api`.
- Gate steps `clean-tree`, `references` and `deny-sync`; the demo has G1, G2
  and G3, with its tests split into `test/unit` and `test/integration`.
- `.asdk/risk-paths.json` raises a task's risk from the paths it changed.
- `merge_policy`: `wt finish` requires the gate and the reviews that the
  effective risk calls for, on the exact commit it merges, by the integration
  branch's rules ([ADR-0007](docs/adr/0007-risk-and-merge-policy.md)).
- `task verify --check review` and `--executor agent`.
- `push_check.block` makes the pre-push hook refuse a commit without a passing
  gate run.

### Profiles, verification and rules (P6b)

- Plan profiles `ultra`, `max`, `pro`: model, effort and isolation per role and
  risk, verifiers per risk; `asdk profile show|apply`; `task start --profile`
  and a `profile` column; merge policy review counts can follow the profile
  ([ADR-0008](docs/adr/0008-plan-profiles.md)).
- `asdk health` warns about environment variables that override profiles.
- `asdk verify run`: start the application per scenario, drive it over HTTP,
  keep the evidence, stop everything it started; `--record` adds a `ui` check
  with the evidence hash. A verify skill for agents; the demo uses both.
- Rules from mistakes: `.asdk/rules.json`, `asdk rules test|check`, the `rules`
  gate step, `asdk-allow` exceptions; a demo rule and one for the kit itself.

## 0.1.0 – 2026-11-24

The first version that can be shown end to end: phases P0 to P5 of the
[roadmap](docs/roadmap.md).

### Workflow (P1)

- `asdk wt new` / `wt finish`: one worktree and branch per task, cut from `dev`;
  finishing rebases onto the latest `dev`, runs the gate on the rebased commit and
  merges with `--no-ff` only while `dev` is still an ancestor of the verified
  commit.
- `asdk gate run`: gates and their steps are configuration (`.asdk/gates.json`);
  each run is bound to its commit and can record the task's check.
- `examples/demo-api` and `tools/demo-setup.mjs`: a throw-away demo project.

### Recording (P2–P4)

- `asdk hook`: Claude Code hook that records metadata only (names, sizes, ids),
  including `SubagentStart`/`SubagentStop` and `PostToolUseFailure`; never blocks.
- `asdk hooks install|uninstall|status`: edits settings on their text; uninstall
  gives back the original bytes ([ADR-0003](docs/adr/0003-byte-preserving-settings-edits.md)).
- `asdk enable|disable`, `asdk health`, `asdk session list|set-project`,
  `asdk project add|remove|list`, `asdk resolve`.
- Task lifecycle: `task start|verify|update|escalate|end|list`; human time with
  `human start|stop|adjust|status`; lock files around every check-then-write
  ([ADR-0004](docs/adr/0004-lock-files.md)).
- `asdk harvest` and `asdk usage`: token usage from transcripts, one count per API
  response ([ADR-0005](docs/adr/0005-usage-harvest.md)); `task end` harvests the
  task's sessions.
- `asdk quota snapshot|plan-change|status`, including stream-json input.

### Reports (P5)

- `asdk report [--harvest]`: `tasks.csv`, `verifications.csv`, `usage.csv`,
  `summary.md` with AI and human time, tokens, quality-adjusted efficiency, task
  coverage, quota and a data-quality grade per row
  ([metrics](docs/metrics.md), [ADR-0006](docs/adr/0006-efficiency-score.md)).
- `asdk push-check`: pushes to the main branch against gate passes on the same SHA.
- `tools/make-sample.mjs` and [examples/sample-report](examples/sample-report/):
  fictional sample data and its reports.

### Quality

- Node.js 22+, no runtime dependencies, `node:test`; CI on Ubuntu and Windows with
  Node 22 and 24, plus gitleaks; tests run in sandboxes with CJK paths and spaces.
