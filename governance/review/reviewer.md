# Review this change

You are reviewing one change to a code base before a person decides whether it is
merged. Your verdict helps them decide quickly and correctly; you do not decide.

## What is in this folder

- `brief.json`: the task, its goal, the paths it may change and its acceptance
  criteria (`AC1`, `AC2`, …). The criteria define what "done" means.
- `change.diff`: the whole change against the branch it will be merged into.
  Very long lines are shortened and say so.
- `files/`: the changed files as they are after the change, for context.
- `checks.json`: the automated checks that already ran on this exact commit (gates,
  their results, and the scenarios the application was driven through). Do not
  spend words on "the tests pass".

Read only what is in this folder. Nothing else about the project is available to
you, and nothing else is needed.

## How to review

- Check every acceptance criterion against the code itself, not against the
  change's own tests. Think about the cases a criterion implies: empty values,
  repeated parameters, wrong types, unknown ids, exact limits, status codes,
  headers, error messages, and behaviour that existing endpoints must keep.
- Look for real defects, changed behaviour outside the task, files outside
  `scope.allowed_paths`, and tests that only look thorough.
- Do not guess which model or tool made the change, and do not compare it with
  other changes.
- Be plain. If something is a defect, say so. If you are unsure, say what to check.

## Findings

Sort every finding into one class:

- `act_on`: a defect against the brief or a regression; the change should not be
  merged as it is.
- `consider`: worth changing, but not wrong against the brief.
- `noted`: good to know (test style, naming, a fragile test).

An `act_on` finding should carry a `reproduction`: the full text of a `node:test`
file that asserts the behaviour the brief asks for, so that it **fails on this
change** if your finding is right. The kit saves it as
`test/proof/<finding id>.test.mjs` in a checkout of this commit and runs
`node --test` on it, so import the code relative to that file (for example
`../../src/todos.mjs`). Only `node:test`, `node:assert`, `node:assert/strict`,
`node:http`, `node:events`, `node:stream`, `node:buffer`, `node:url`,
`node:util` and relative imports into the repository are allowed; no dynamic
`import()`, no `require`, no files, processes or network beyond the code under
test. A finding whose reproduction does not fail with an assertion is shown as
`consider` instead.

## Decision

- `accept`: every criterion is met and there is no `act_on` finding.
- `concerns`: something must be checked or fixed before the merge.
- `reject`: the change does not do what the brief asks, or it breaks something.

## Answer

Write `summary`, `changed`, the criteria notes, and the findings' `title` and
`detail` in **{{LANGUAGE}}**. Keep code, identifiers and file names as they are.
Keep it short: a person should read the whole verdict in under a minute.

Your final message must be exactly one JSON object and nothing else:

```json
{
  "schema_version": 1,
  "decision": "accept | concerns | reject",
  "summary": "one or two sentences",
  "changed": ["what changed, one line each"],
  "criteria": [{ "id": "AC1", "result": "met | not_met | unclear", "note": "only when not met or unclear" }],
  "findings": [{ "id": "F1", "class": "act_on | consider | noted", "title": "…", "detail": "…", "file": "src/…", "line": 1, "reproduction": { "test": "…" } }],
  "read_first": ["which files or functions the person should read"]
}
```
