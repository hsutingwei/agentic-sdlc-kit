# adapters/claude-code

Everything that only works with Claude Code lives here, so the rest of the kit
depends on `core/` contracts and git alone. See
[ADR-0001](../../docs/adr/0001-claude-code-first-tool-neutral-core.md).

Contents:

- **`hook.mjs`** – `asdk hook`: turns a Claude Code hook payload into an `event`. Fields come from an allowlist; prompt, tool input, tool output, answers and tool errors are reduced to their size. It always exits 0, gives up on stdin after 5 seconds, and returns at once while recording is disabled.
- **`install.mjs`, `cli.mjs`** – `asdk hooks install|uninstall|status [--scope user|local] [--project <dir>]`. Edits settings on their text and undoes exactly what it added ([ADR-0003](../../docs/adr/0003-byte-preserving-settings-edits.md)); backups go to `~/.agentic-metrics/backups/claude-settings/`. Events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SubagentStart`, `SubagentStop`, `SessionEnd`.

Planned:
- Transcript harvest for token usage per model and per sub-agent (P4).
- Sub-agent definitions generated from role and model-tier profiles (P6).
- Mapping of `task-brief` isolation levels to Claude Code: `fresh` → a sub-agent; `sterile` → a headless run in a directory outside the repository with CLAUDE.md, memory, skills, hooks and MCP disabled (P7).

Other tools (Codex, Cursor, …) can be supported by adding a sibling adapter;
none is planned in this project.
