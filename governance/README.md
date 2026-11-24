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
- **P6b (done):**
  - [`profiles/`](profiles/): plan profiles (`ultra`, `max`, `pro`) giving each role a tier, model, effort and isolation, overridable by risk, and verifiers per risk. `asdk profile show` (also `--format claude-args` for headless runs) and `asdk profile apply`, which writes `model` and `effort` into `.claude/agents/*.md`. A project adds plans or replaces profiles in `.asdk/profiles.json` ([ADR-0008](../docs/adr/0008-plan-profiles.md)). A merge policy review count may be `"profile"`.
  - [`verify/`](verify/): `asdk verify run [--record]` starts the application as `.asdk/verify.json` says, once per scenario in `test/scenarios/`, drives it over HTTP, stops it with everything it started, and keeps the evidence (requests, responses, last output) with its SHA-256; `--record` adds a `ui` check on the exact commit. [`templates/skills/verify/`](templates/skills/verify/SKILL.md) tells agents to write one scenario per acceptance criterion and report the evidence.
  - Rules from mistakes: `.asdk/rules.json` (pattern, a message that says how to fix it, origin, bad and good examples), `asdk rules test|check` and the `rules` gate step; `asdk-allow: <id>` marks a deliberate exception.
