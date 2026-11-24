---
name: verify
description: Verify a change on the running application before reporting it done. Writes one scenario per acceptance criterion, runs asdk verify, and reports the evidence. Use when a task brief has acceptance criteria that the application's interface shows.
allowed-tools: Read, Grep, Glob, Write, Edit, Bash(asdk verify *)
---

# Verify on the running application

A passing unit test says the code does what the test expects. This skill checks
what a user of the application would see, and leaves evidence a reviewer can
read without running anything.

`asdk verify run` does the mechanical part: it starts the application as
`.asdk/verify.json` says, waits until it answers, sends the requests of each
scenario, compares the answers, saves the evidence and stops the application
and everything it started, also when something fails. Do not edit
`.asdk/verify.json`; if the application cannot be started that way, stop and
report it as `blocked`.

## Steps

1. **One scenario per acceptance criterion.** For each criterion the interface
   can show, add a JSON file `test/scenarios/<TASK-ID>-<criterion>.json` with
   `"criteria": ["<criterion>"]`.
   Each step has a `request` (`method`, `path`, optional `json`) and an
   `expect` (`status`, and optionally `json` with the fields that must match,
   or `length` for a list). `"save": { "id": "id" }` keeps a value from the
   answer for later steps as `{id}`. Include the cases the criterion rules out,
   such as a value that must be refused.
2. **Run them:** `asdk verify run` (all scenarios) or
   `asdk verify run <scenario>`.
3. **When a step fails,** read its reason and the application's last output in
   the result. Fix the code. Change an expectation only when it contradicts the
   brief, and say so in your report.
4. **Commit, then record:** `asdk verify run --record` ties the result to the
   commit you stopped at. It refuses while there are uncommitted changes.
5. **Report the evidence.** In the `acceptance` entry of each criterion, give
   the scenario name, its result and the `sha256` that `asdk verify` printed.
   A criterion without a scenario that passed is `not_verified`, not `met`.
