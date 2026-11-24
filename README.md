# agentic-sdlc-kit

[繁體中文](README.zh-TW.md)

> **Status: early development (P4 of 10 done).** A minimal end-to-end slice works:
> task → worktree → sub-agent → gate → merge → scorecard, and Claude Code hooks can be
> installed and removed without a trace. See the [roadmap](docs/roadmap.md).

AI coding agents can write code quickly, but the process around them is usually
opaque: a planner that cannot see the source reviews claims it cannot check,
parallel work collides at merge time, and nobody can say whether the team is
actually faster. **agentic-sdlc-kit** makes agent-driven development
*governable* (rules, permissions and risk-based gates), *verifiable* (every
claim an agent makes is checked against the diff and a gate run on the same
commit) and *measurable* (append-only records of what happened, with an explicit
data-quality flag on every number). Claude Code is the first supported tool; the
core contracts are tool-neutral.

## Quick start

Requires Node.js 22 or newer and git. There are no dependencies to install.

```sh
git clone <this repository>
cd agentic-sdlc-kit
npm test
```

To try the flow on a throw-away demo project, follow [docs/demo.md](docs/demo.md):

```sh
node tools/demo-setup.mjs ~/work/demo-api
cd ~/work/demo-api
node <kit>/bin/asdk.mjs task start DEMO-001 --type feature --risk low --estimate 6
node <kit>/bin/asdk.mjs wt new DEMO-001 --slug due-date
```

### Record your own Claude Code sessions

```sh
node <kit>/bin/asdk.mjs project add demo-api ~/work/demo-api
node <kit>/bin/asdk.mjs hooks install     # edits ~/.claude/settings.json, after a backup
node <kit>/bin/asdk.mjs health            # checks the setup and times one hook call
node <kit>/bin/asdk.mjs usage --task DEMO-001   # tokens by model and agent type
node <kit>/bin/asdk.mjs quota status      # plan and the latest quota snapshot
node <kit>/bin/asdk.mjs disable           # pause; enable resumes
node <kit>/bin/asdk.mjs hooks uninstall   # gives back the original bytes
```

Only metadata is recorded (event names, tool names, sizes, ids), never prompt text,
file contents or paths. Data stays in `~/.agentic-metrics/`.

## Modules

| Module | Purpose | Phase |
|---|---|---|
| [`core/`](core/) | Contracts shared by every module (task, task brief, agent report, gate summary, event, usage) and a dependency-free validator | P0 ✅ |
| [`collector/`](collector/) | Records each task from start to acceptance: hook events, task lifecycle, token usage, reports | P1–P5 |
| [`governance/`](governance/) | Agent instruction templates, permission examples, risk-based gates (G1/G2/G3) | P6 |
| [`orchestration/`](orchestration/) | Planner workflow, dispatch to sub-agents by model tier, worktree pool for parallel tasks | P1, P7 |
| [`skill-regression/`](skill-regression/) | Regression tests for reviewer agents and skills with seeded-defect cases | P8 |
| [`adapters/claude-code/`](adapters/claude-code/) | Everything specific to Claude Code: hooks, transcript harvest, agent definitions | P1– |
| [`examples/demo-api/`](examples/demo-api/) | A tiny todo REST API the gates and reviewers are applied to | P6 |

## Sample report

_TBD (P5): a table generated from fictional sample data by `tools/make-sample.mjs`._

## Design principles

- **No third-party runtime dependencies.** Node built-ins only; tests use `node:test`.
- **Append-only records.** Corrections are new records; history is never rewritten.
- **Metadata, not content.** No prompt text or file contents are stored.
- **Claims are verified, not trusted.** Agent reports are checked against git and gate results.
- **Honest numbers.** Every metric row carries `Complete`, `Partial` or `Missing` and the reason.

## Contributing safely

Commits are checked against a private keyword list kept **outside** the repository
(`npm run hooks:install` sets up this git hook; it is unrelated to `asdk hooks install`):

```sh
npm run hooks:install
# then create ~/.config/agentic-sdlc-kit/denylist.txt
```

One rule per line, matched case-insensitively against file contents and names:

```text
# Comments sit on their own line.
# Block: a plain keyword, then a JavaScript regular expression.
acme-corp
re:\bEMP[0-9]{6}\b
# Warn only: printed, but the commit is allowed.
warn:widget-flux
warn:re:\bpdr\b
```

Hits are reported by file, line and rule line number; the matched text is never
printed. Set `AGENTIC_SDLC_DENYLIST` to use another file, or
`AGENTIC_SDLC_DENYLIST=none` to skip the check on purpose. CI also scans the full
history with gitleaks.

## Limitations

_TBD (P9)._

## License

[MIT](LICENSE)
