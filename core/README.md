# core

Contracts shared by every module, and a validator that needs nothing but Node.

| Contract | Written by | Read by |
|---|---|---|
| [`task`](schemas/task.schema.json) | collector (derived from events) | reports, scorecard |
| [`task-brief`](schemas/task-brief.schema.json) | the planner | the dispatched agent (its only input), the reviewer |
| [`agent-report`](schemas/agent-report.schema.json) | any agent, any tool | the planner, which checks it against git and gate results |
| [`gate-summary`](schemas/gate-summary.schema.json) | gates (`summary.json`) | collector, push check, planner |
| [`event`](schemas/event.schema.json) | hooks, CLI, gates | collector |
| [`usage`](schemas/usage.schema.json) | adapters (harvest from transcripts) | collector (`asdk usage`, reports) |

The schemas are standard JSON Schema 2020-12, so other tools can validate them
with any validator. Valid examples live in [`test/fixtures/`](test/fixtures/).

## Validating a file

```sh
node core/validate-cli.mjs agent-report report.json
node core/validate-cli.mjs event events.jsonl --jsonl
node core/validate-cli.mjs --list
```

Exit codes: `0` valid, `1` invalid, `2` usage or I/O error.

## Supported JSON Schema subset

`core/validate.mjs` implements: `type`, `enum`, `const`, `properties`,
`required`, `additionalProperties`, `minProperties`, `maxProperties`, `items`,
`minItems`, `maxItems`, `uniqueItems`, `minLength`, `maxLength` (code points),
`pattern` (Unicode mode), `format: date-time`, `minimum`, `maximum`,
`exclusiveMinimum`, `exclusiveMaximum`, `allOf`, `if`/`then`/`else`, and local
`$ref` to `#/$defs/<name>`. Annotations (`title`, `description`, `$comment`,
`examples`, `default`, `$id`, `$schema`) are ignored.

**Any other keyword makes the schema fail to compile.** A validator that silently
skipped unknown keywords would make a contract look stricter than it is.

Because references are local only, definitions shared between schemas are
repeated in each file; a test fails if any copy drifts.

## Shared helpers

- `git.mjs` – shell-free git calls (`git`, `tryGit`, `repoInfo`, `headSha`, `isClean`).
- `errors.mjs` – `AsdkError` with an exit code: 1 when a rule or check says no, 2 for usage or configuration problems.
- `cli.mjs` – argument parsing for the `asdk` commands, built on `node:util` `parseArgs`.

## Rules the schemas cannot express

Some rules span several fields or records and are enforced in code instead:

- `gate-summary.risk.effective` must be at least the higher of `declared` and `path_minimum`.
- An `agent-report` is only trusted when `brief_sha256` matches the brief and `head_sha` has a passing gate summary.
- `event.data` must never hold prompt text or file contents. The schema limits it to
  32 short scalar fields; the writers use an allowlist of fields.
