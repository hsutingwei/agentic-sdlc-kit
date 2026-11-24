# Governance templates

Copy these into a project and fill in the project notes.

| File | Goes to | Purpose |
|---|---|---|
| `AGENTS.md` | repository root | Rules for any coding agent: safety boundaries, plan before editing, verification by risk, the report format. Tool-neutral. |
| `CLAUDE.md` | repository root | One line, `@AGENTS.md`. Claude Code reads `AGENTS.md` on its own only when there is no `CLAUDE.md`, so the import makes it load in every case. |
| `settings.json` | `.claude/settings.json` | Claude Code permission deny rules: pushing, hard resets, reading secrets, editing gates and permissions. |

`examples/demo-api` uses all three.

## Deny rules are not a security boundary

A deny rule matches how a command is written, not what it does.
`Bash(rm -rf *)` stops `rm -rf build`, but not `rm -r -f build`, a script that
deletes files, or `node -e` doing the same. The rules catch an agent's honest
mistakes and make intent visible; they do not contain an agent that tries to get
around them. Real limits come from where the agent runs: a worktree, an account
without push rights, a sandbox, and the gates before anything is merged.

Two more things to know:

- Claude Code combines deny lists from every settings file that applies, and a
  deny anywhere cannot be allowed elsewhere.
- A shared `.claude/settings.json` is read from the directory Claude Code starts
  in, with no fallback to the parent. A subdirectory with its own
  `.claude/settings.json` therefore replaces the root rules when a session starts
  there. The `deny-sync` gate step checks that every such file repeats the root's
  deny rules.

`Read(**/.env.*)` also hides `.env.example`; drop it if agents need to read the
example file.
