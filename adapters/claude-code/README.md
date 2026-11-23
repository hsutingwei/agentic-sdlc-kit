# adapters/claude-code

Everything that only works with Claude Code lives here, so the rest of the kit
depends on `core/` contracts and git alone. See
[ADR-0001](../../docs/adr/0001-claude-code-first-tool-neutral-core.md).

Planned contents:

- Hook entry points that turn Claude Code hook payloads into `event` records (P1–P2).
- Transcript harvest for token usage per model and per sub-agent (P4).
- Sub-agent definitions generated from role and model-tier profiles (P6).
- Mapping of `task-brief` isolation levels to Claude Code: `fresh` → a sub-agent; `sterile` → a headless run in a directory outside the repository with CLAUDE.md, memory, skills, hooks and MCP disabled (P7).

Other tools (Codex, Cursor, …) can be supported by adding a sibling adapter;
none is planned in this project.
