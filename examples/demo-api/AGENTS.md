# Agent rules

These rules apply to every AI coding agent working in this repository, in an
interactive session or as a sub-agent. Project-specific notes are at the end.

## Safety boundaries

- Never print, copy or commit credentials: passwords, tokens, keys, connection
  strings, `.env` files. If you come across one, say where without repeating it.
- Stop and ask before anything destructive or hard to undo: SQL that drops,
  truncates or deletes without a narrow `WHERE`, schema migrations, `rm -r`,
  `git reset --hard`, `git clean`, force pushes, rewriting history.
- Never overwrite or revert changes that are not part of your task. If a file
  you need has someone else's uncommitted changes, stop and say so.
- Never push. Pushing to the shared server is a human step after the release gate.
- Never weaken a check to make it pass: do not edit gates, risk rules,
  permissions or tests written for an acceptance criterion unless the task says so.

## Plan before editing

- **Interactive session:** before changing files, list what you will change
  (files, behaviour, risks) and wait for the human to confirm. A request that
  already says exactly what to do, such as running a sub-agent on a named brief,
  is that confirmation.
- **Sub-agent with a task brief:** the brief is the confirmed plan. Change only
  files matching `scope.allowed_paths`, never `scope.forbidden_paths`. If the task
  cannot be done inside those paths, stop and report `blocked` with the reason.

## Verification by risk

The effective risk is the higher of the risk the task declared and the minimum
that the changed paths call for (`.asdk/risk-paths.json`). It is never lowered.
Every verdict counts only for the exact commit that is merged.

| Effective risk | Required before merging into the integration branch |
|---|---|
| low | G1 passes |
| medium | G2 passes, plus one independent review |
| high, critical | G2 passes, plus a review by an agent and a review by a human |

`.asdk/gates.json` (`merge_policy`) is the authority; this table explains it.
Acceptance is always recorded by a human.

## Reporting

Finish with a report in the `agent-report` format: task id, the SHA-256 of the
brief, your role, status (`completed`, `partial`, `blocked` or `failed`), the
commit you stopped at, the files you changed, one entry per acceptance criterion
(`met`, `not_met` or `not_verified`, with short evidence) and the checks you ran.

- Claim a check passed only if you ran it in this session on that commit.
- Evidence is output you saw (a test summary, a response body), not "it should work".
- Say what you did not do or could not verify.

## Project notes

- demo-api is a fictional todo-list REST API on `node:http`, with no dependencies.
- Start it with `npm start` (port 3000, or `PORT`). Unit tests of the store are in
  `test/unit/`, HTTP tests in `test/integration/`; `npm test` runs both.
- Gates: `asdk gate run G1` (syntax, rules, unit), `G2` (adds the agent
  configuration checks and integration tests), `G3` (clean tree, then G2's
  steps; run before pushing).
- Verify on the running API with `.claude/skills/verify/SKILL.md`; scenarios
  live in `test/scenarios/`. `.asdk/rules.json` lists mistakes not to repeat.
- `src/server.mjs` is the public HTTP contract (medium risk); package files are
  medium; `.asdk/`, `.claude/`, `AGENTS.md` and `CLAUDE.md` are high.
- Task briefs are in `briefs/`; the implementer sub-agent is `.claude/agents/implementer.md`.
