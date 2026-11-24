# orchestration

Runs several tasks in parallel without them colliding, with the planner able
to read the source it plans and reviews.

- **P1 (done)** – `asdk wt new` / `asdk wt finish`: one git worktree per task, branched from `dev`; finish rebases onto the latest `dev`, runs the gate on the rebased commit, and merges with `--no-ff` only when it passes.
- **P6a (done)** – `wt finish` follows the merge policy: the gate and the reviews it requires depend on the effective risk of the rebased commit, by the integration branch's rules ([ADR-0007](../docs/adr/0007-risk-and-merge-policy.md)).
- **P7** –
  - Planner workflow: write a `task-brief`, dispatch it to a sub-agent of the right model tier, check the returned `agent-report` against the diff and the gate summary.
  - Worktree pool: a fixed number of slots (the WIP limit). A slot is reused only when it is clean and its branch is merged or explicitly abandoned; reuse is a plain `git switch`, never `reset --hard`. Dependencies are reinstalled only when the lockfile hash changes.
  - Overlap warning when two active tasks declare the same paths.
  - Dispatch guard (a hook) that asks the user before starting another sub-agent when the concurrency limit is reached, and a `budget status` command.
  - Context isolation levels: `fresh` (new context, project rules) and `sterile` (only the brief's inputs).
