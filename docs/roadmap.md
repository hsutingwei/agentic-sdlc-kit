# Roadmap

Each phase starts with a written plan that is confirmed before work begins, and
ends with `npm test` actually run and the result reported.

| Phase | Scope | Status |
|---|---|---|
| P0 | Skeleton, test runner and sandbox, denylist pre-commit hook, CI with gitleaks, `core/` contracts and validator, ADR-0001, [Claude Code behaviour spike](spike/claude-code-behavior.md) | done; CI not yet run |
| P1 | End-to-end slice on DEMO-001: `wt new` → sub-agent implements → G1 → `task verify` → merge to `dev` → `task end` → one scorecard row ([demo](demo.md)) | done |
| P2 | Collector: project registry (worktree-aware, `session set-project`, `project remove`), hook recording incl. `SubagentStart`/`SubagentStop`/`PostToolUseFailure`, `hooks install/uninstall` (byte-exact, [ADR-0003](adr/0003-byte-preserving-settings-edits.md)), `enable/disable`, `health` | done |
| P3 | Collector: task lifecycle CLI (`task update/escalate`, `human start/stop/adjust/status`), lock files ([ADR-0004](adr/0004-lock-files.md)), multi-process contention tests | done |
| P4 | Collector: token usage harvest (`asdk harvest`, `asdk usage`, after `task end`; [ADR-0005](adr/0005-usage-harvest.md)), quota snapshots from flags, JSON or stream-json, plan changes, `asdk quota status` | done |
| P5 | Collector: reports ([metrics](metrics.md), [ADR-0006](adr/0006-efficiency-score.md)), push check, efficiency scorecard, fictional [sample report](../examples/sample-report/); a [real Claude Code run](demo-run.md) of the demo; merge to `main` as v0.1 | done |
| P6a | Governance templates (`AGENTS.md`, `CLAUDE.md`, deny rules) and gates G1–G3 applied to `examples/demo-api`; `references` and `deny-sync` checks; risk paths; merge policy by effective risk ([ADR-0007](adr/0007-risk-and-merge-policy.md)); blocking pre-push check | done |
| P6b | Profiles that pick model, reasoning effort, isolation and verifier count from plan × risk × role ([ADR-0008](adr/0008-plan-profiles.md)); `asdk verify` and a verification skill (launch, health check, drive, evidence, clean-up); repeated mistakes turned into checked rules | done |
| E1 | Experiment while quota is plentiful: 12 small demo tasks run with the `ultra`, `max` and `pro` profiles, comparing human review minutes, first-pass rate, escaped defects and tokens per task; results with sample size and limits in [experiments.md](experiments.md). E1a (task catalogue, runner, blind review, analysis) done; E1b (running it) and E1c (results) next | E1a done |
| P7 | Orchestration, scoped by E1: planner workflow with one playbook per task type (skipped steps carry a reason), report verification, isolation levels, worktree pool, dispatch guard, `budget status` with tier downgrade on low quota, a local job queue for gates and installs | |
| P8 | Skill regression and reviewer cases | |
| P9 | Documentation, ADRs, README, pre-publication checks (full-history scan, action pinning) | |

**Demo-ready line:** after P1 and P5 the kit can be shown end to end (v0.1);
later phases deepen it. From P6 on, the kit records its own development
(dogfooding); only aggregated numbers are published.

## Priorities toward the 3× goal

The efficiency score divides the human estimate without AI by the **human hours**
spent, so the target is less human time per task, not only more tasks at once.
Expected bottlenecks, most important first (to be confirmed by P5 data):

1. **Human review time** – the denominator itself. Clear acceptance criteria in
   the brief, gates and reviewer agents before a human looks, agent reports checked
   against the diff, and risk-based merging (P6, P7, P8).
2. **Subscription quota** – caps volume on ordinary plans; rework spends it twice.
   Model tiers per role, short sterile contexts, `budget status` and the dispatch
   guard (P4, P6, P7).
3. **Merge conflicts** – cause rework. Small tasks split by module, declared paths
   with an overlap warning, frequent rebases (P7).
4. **Local resources** – matter only from about four parallel worktrees. Gates and
   dependency installs share a queue whose slots default from CPU cores and free
   memory and are checked against current load before each job starts; running
   jobs are never preempted (P7, using the P3 locks). Agent concurrency is set by
   quota and the WIP limit, not by CPU: the models run remotely.

## Plans and profiles

The kit is developed on a top-tier plan but must serve ordinary ones (Pro, Max).
Profiles therefore take the plan as an input. Starting points, to be checked by E1:

| Profile | Implementation | Tests and review | Notes |
|---|---|---|---|
| `ultra` | Opus, `xhigh` for design and high risk, `high` otherwise | lighter model, sterile | several independent verifiers on medium risk and above |
| `max` | Opus `high` | lighter model | one verifier, more for high risk |
| `pro` | Sonnet `high`; Opus only for high risk | lightest model | one verifier, fewer parallel tasks |

Token counts per task do not depend on the plan, so E1 on a large plan can
estimate the cost on smaller ones; `asdk quota plan-change` (P4) lets the
reports compare real numbers before and after a plan change.

## Ideas borrowed from other workflows

Reviewed: pstack (Lauren Tan, a Cursor plugin; read through third-party
write-ups only). The kit stays neutral about skill packs: ideas are reimplemented
here from scratch, and whether a pack helps is measured, not assumed (E1).

- Evidence over "the build passed": verify on the real interface and attach the
  output (P6 verification skill).
- A verdict counts only for the exact commit that merges (already the merge rule).
- A mistake that repeats becomes structure: types or a lint rule whose message
  names the fix, then a test, and only last an agent rule; each new check is
  proven against the real past mistake (P6, P8).
- One playbook per task type, copied into the task list; skipped steps keep a
  reason (P7).
- Parallel workers report PASS, ISSUES or BLOCKED (P7).
- Review findings are sorted (act on, consider, noted, dismissed) and never
  applied automatically (P8).
- Verifier count follows risk: verification is token-intensive (P6, P7).
- Not adopted: automatic merges to `main`. Only `dev` may receive merges
  without a human, and only for low-risk tasks that passed independent checks.

## Decisions so far

- **Tool scope** – Claude Code first, tool-neutral core ([ADR-0001](adr/0001-claude-code-first-tool-neutral-core.md)).
- **Branches** – `main` is released to the git server; `dev` integrates; every task works in its own worktree branched from `dev`.
- **Context isolation** – implementers run as sub-agents with a fresh context; testers and reviewers run `sterile`: a headless run outside the repository with CLAUDE.md, memory, skills, hooks and MCP disabled. A stricter mode that needs an API key is optional.
- **Efficiency score** – the baseline is a human estimate without AI, recorded at task start and never edited. Quality discounts apply: first-pass rate, rework, escalations, and escaped defects (a fix task links back with `--fixes`). Only `Complete` rows are scored, and the estimate's bias is a documented limitation.
- **Parallel work** – a WIP limit, a "waiting for human" time metric, an overlap warning on declared paths, and G2 on the branch rebased onto the latest `dev`.
- **Worktrees** – short slot names under a short, configurable root (Windows path length); dependencies reinstalled only when the lockfile hash changes; local files copied only from an explicit, empty-by-default allowlist; a pool of reusable slots (P7).
- **Dispatch guard** – a Claude Code hook on `PreToolUse` for the `Agent` tool, not an MCP server: it is enforced, costs no tokens and reuses recorded events. A CLI serves queries.
- **Quota data** – headless runs the kit launches record `rate_limit_event` from stream-json automatically; interactive sessions rely on `task snapshot`. See the [spike](spike/claude-code-behavior.md).
- **Headless runs** – launched with a scrubbed environment; `sterile` means `--safe-mode --no-session-persistence --strict-mcp-config` with a restricted tool list, outside the repository.
- **Licence holder** – "agentic-sdlc-kit contributors".
- **CLI** – one entry point, `asdk`, dispatching to the modules.
- **Events** – append-only, state derived from them ([ADR-0002](adr/0002-append-only-events.md)).
- **Worktree layout** – `~/wt/<project>/<TASK-ID>` by default (configurable), branch `<type prefix>/<TASK-ID>-<slug>`.
- **Merging** – rebase onto the latest `dev`, run the gate on the rebased commit, then `merge --no-ff`, only while `dev` is still an ancestor of that commit, so the merged tree is the tree the gate verified.
- **Demo** – `examples/demo-api` is a template; `tools/demo-setup.mjs` creates a separate repository from it and installs the hooks in that repository's local settings, so running the demo never touches `~/.claude`.
- **Hook install** – `asdk hooks install` edits the user settings (`$CLAUDE_CONFIG_DIR/settings.json` or `~/.claude/settings.json`) on their text, records what it added, and backs up before every write; uninstall restores the original bytes ([ADR-0003](adr/0003-byte-preserving-settings-edits.md)). `--scope local` targets a project's `settings.local.json`.
- **Hook command** – an absolute node path (Claude Code's hook PATH may lack node), a 10-second timeout, and a 5-second limit on waiting for the payload. Git Bash runs it on Windows; without Git Bash the PowerShell form is written (not yet tried with Claude Code).
- **Sessions outside projects** – recorded with `project_id: null` so reports can show AI use outside tasks; `"record_unregistered": false` in `config.json` drops them. Paths are never recorded.
- **Usage** – harvested from transcripts into rebuildable `usage/<session>.json` files (core contract `usage`), one count per API response, numbers and names only ([ADR-0005](adr/0005-usage-harvest.md)). `task end` harvests the task's sessions and only warns on failure.
- **Quota** – `asdk quota snapshot|plan-change|status`; a snapshot keeps percentages, reset times and the plan name only. Windows: `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet` (only `seven_day` seen so far) or any similar name. Plan names are free-form (`pro`, `max-5x`, …). A plan change may be backdated, never before the previous one or into the future.
- **Efficiency** – estimate without AI ÷ human hours × a quality factor (−0.1 failed first check, −0.1 per escalation up to −0.3, −0.3 escaped defect, floor 0.5; configurable). The headline divides the quality-weighted estimate of accepted tasks by the human hours of all Complete tasks ([ADR-0006](adr/0006-efficiency-score.md)).
- **Grades** – `Complete` (scored), `Partial` (shown with flags, not in the headline), `Missing` (no score).
- **Push check** – warns by default; with `push_check.block` the pre-push hook refuses a commit without a passing run of the push gate (G3). Push times from the hook, else approximately from the reflog.
- **Risk and merging** – effective risk is the higher of the declared risk and the minimum from `.asdk/risk-paths.json`; `merge_policy` sets the gate and the reviews per risk (low: G1; medium: G2 + one review; high and critical: G2 + an agent and a human review), all on the exact commit merged; the rules are read from the integration branch ([ADR-0007](adr/0007-risk-and-merge-policy.md)).
- **Reviews** – `task verify --check review` with `--executor agent|human`, always bound to a commit. Reviewer agents come in P8.
- **Templates** – `AGENTS.md` holds the rules; `CLAUDE.md` is one line, `@AGENTS.md`, because Claude Code reads `AGENTS.md` on its own only without a `CLAUDE.md`. Deny rules use the `Bash(cmd *)` form and are documented as not a security boundary.
- **Profiles** – roles map to tiers and tiers to models per profile, with overrides by risk; the plan comes from `--plan` or the latest plan change; a project replaces whole profiles; `profile apply` writes agent files only when asked; `task start` records the profile; a review count may be `"profile"` (1 without a profile); `health` warns about `CLAUDE_CODE_EFFORT_LEVEL` and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` ([ADR-0008](adr/0008-plan-profiles.md)).
- **Verification** – `.asdk/verify.json` (protected) says how to start the application; scenarios in `test/scenarios/` (editable by agents) each get a freshly started application; evidence stays in `~/.agentic-metrics/evidence/` with response bodies up to 4 KB (`record_bodies: false` drops them); `--record` adds a `ui` check with the evidence hash, only on a clean tree.
- **Rules from mistakes** – `.asdk/rules.json`; each rule must catch its bad examples and spare its good ones before it counts; exceptions are marked in the code with `asdk-allow`. The kit keeps one rule of its own (no real home directory in tests), derived from a project rule rather than a past mistake.
- **E1** – 12 fictional tasks with hidden tests and reference solutions, proven fair by a test; 36 runs plus 6 repeats with `max`, seeded and interleaved, pilot first; one retry after a failed gate; every run reviewed blind and timed by the person, the review also being the acceptance; escaped defect = hidden tests failing after the merge; data in the experiment folder, only aggregated files published; no external skill pack in the first round; E1 repositories use a merge policy where the person's review is the one review every risk level needs, because reviewer agents come in P8.
- **Dogfooding** – after P6a the kit's own repository is registered and its hooks go into its `.claude/settings.local.json`; data goes to the real `~/.agentic-metrics`.
- **Locks** – one lock file per resource (`tasks`, `config`, `recording`, `claude-settings`); stale only when older than 30 s and its process is gone; give up after 10 s. Hooks take none ([ADR-0004](adr/0004-lock-files.md)).
- **Damaged records** – a damaged line in the manual stream stops task changes and names the file and line; damaged hook lines are only counted.
- **Event order** – streams are merged by time, but each keeps its own line order, because process clocks can disagree by a few milliseconds.
- **Blocked tasks** – `task update --state blocked --waiting-on human|ai|external|quota|other`; a blocked task stays open (verify, escalate, end).
- **Human time** – one timer at a time (`--switch` moves it), activities spec, review, fix, acceptance, other; corrections are separate adjustments and a total never goes below 0; `task end` stops a running timer and flags it; periods over 8 h are flagged.
- **Pausing** – `asdk disable` / `enable` switch recording off and on without touching settings; both are recorded so reports can mark the gap.
