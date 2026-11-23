# governance

Templates and gates that set what an agent may do and what must be proven
before its work is accepted. Planned for **P6**.

- `templates/AGENTS.md` – tool-neutral agent rules: safety boundaries, plan before editing, fixed report format, verification by risk level. Claude Code reads it through an `@AGENTS.md` import in `CLAUDE.md`.
- `templates/settings.json` – Claude Code permission deny examples. Deny rules match how a command is written; they are not a security boundary.
- `gate/` – one cross-platform Node script for G1 (lint, unit), G2 (adds integration, runs on the branch rebased onto the latest `dev`) and G3 (clean tree, verifies the exact SHA to be pushed). Writes a `gate-summary` and can record the result with the collector.
- `risk-paths.json` – minimum risk by changed path. Risk can be raised, never lowered automatically.
- Role and model-tier profiles: which role runs on which tier (`light`, `standard`, `strong`) and how many agents may run at once.
