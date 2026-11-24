# governance

Templates and gates that set what an agent may do and what must be proven
before its work is accepted.

- **P1:** `asdk gate run <GATE> [--task ID] [--record]` reads gates from the project's `.asdk/gates.json` (steps are argv arrays or built-ins), writes a `gate-summary`, and can record the result on the task.
- **P6a (done):**
  - [`templates/`](templates/): `AGENTS.md` (safety boundaries, plan before editing, verification by risk, the report format), `CLAUDE.md` importing it, and `settings.json` with permission deny rules, with why deny rules are not a security boundary.
  - Built-in steps: `syntax-check`, `clean-tree` (no uncommitted or untracked files), `references` (paths named in agent instructions exist), `deny-sync` (nested `.claude/settings.json` files repeat the root deny rules).
  - `.asdk/risk-paths.json`: minimum risk by changed path; the gate records declared, path minimum and effective risk.
  - `merge_policy` in `.asdk/gates.json`: per effective risk, the gate and the reviews (`any`, `agent`, `human`) that `wt finish` requires on the exact commit it merges. Rules are read from the integration branch ([ADR-0007](../docs/adr/0007-risk-and-merge-policy.md)).
  - `push_check.block`: the pre-push hook refuses a commit without a passing run of the push gate.
  - `examples/demo-api` uses all of it: G1 (syntax, unit), G2 (adds the agent checks and integration tests), G3 (clean tree, then G2).
- **P6b (next):** profiles that pick model, reasoning effort, isolation and verifier count from plan, risk and role; a project verification skill; repeated mistakes turned into checked rules.
