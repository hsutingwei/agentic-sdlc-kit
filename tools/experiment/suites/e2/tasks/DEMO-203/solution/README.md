# demo-api

A small, fictional todo-list REST API used as the target project for the
agentic-sdlc-kit demos. It uses `node:http` only. Items are kept in memory, and
in a JSON file as well when `DATA_FILE` names one.

```sh
npm start                               # http://127.0.0.1:3000, in memory
DATA_FILE=data/todos.json npm start     # loaded from the file, saved after every change
npm test
```

An item is `{ "id": 1, "title": "...", "done": false, "due_date": "2026-01-31", "priority": "normal" }`;
`due_date` is `null` when the item has none. Dates are calendar dates in UTC.
`priority` is `low`, `normal` or `high`; an item created without one is `normal`.

The data file is version 2: `{ "version": 2, "next_id": 3, "items": [...] }`, each
item with its priority. A version 1 file (no priorities) is still read, its
items as `normal`, and is rewritten as version 2 when the next change is saved.
Any other file is refused and left as it is.

## HTTP contract

| Method | Path | Result |
|---|---|---|
| GET | `/todos` | the items in id order; see the query below |
| POST | `/todos` | create `{ "title": "...", "due_date": "...", "priority": "..." }` → 201 with the item |
| POST | `/todos/import` | create every item of `{ "items": [...] }`, or none when one is not valid → 201 with the items |
| GET | `/summary` | `{ "total", "done", "open", "overdue", "due_today", "high_open" }`; `high_open` counts the items that are not done and have priority `high` |
| GET | `/todos/:id` | the item |
| PATCH | `/todos/:id` | change `title`, `done`, `due_date` and/or `priority` → the item |
| DELETE | `/todos/:id` | 204 |

`GET /todos` takes `done=true|false`, `overdue=true` (not done and due before
today), `q=<text>` (the title contains the text, whatever the letter case) and
`priority=low|normal|high`.
Any other parameter, or another value, answers 400.

Rules that hold for every request:

- Bodies are JSON, in and out. An error is `{ "error": "<message>" }`.
- `:id` is a positive whole number in decimal digits without leading zeros.
  Anything else in its place (`0`, `007`, `1.0`, `abc`) is not a route.
- A path that is not a route answers 404 `not found`, whatever the method.
- A route asked with a method it does not have answers 405 `method not allowed`.
  `/todos/import` and `/summary` are routes of their own, never an `:id`.
- An item that does not exist answers 404 `not found`. A body is read and
  checked before the item is looked up, so a body that is not JSON answers 400
  even for an item that does not exist.
- Input that is not valid answers 400 with the reason: a title that is empty or
  longer than 200 characters, a `done` that is not `true` or `false`, a
  `due_date` that is not a real date written as `YYYY-MM-DD` (or `null`), a
  `priority` that is not one of the three, a body
  over 64 KB or not JSON.
- A request that is refused changes nothing and uses up no id.

## Layout

| File | What it holds |
|---|---|
| `src/server.mjs` | the HTTP layer |
| `src/todos.mjs` | the store and the validation of items |
| `src/query.mjs` | the filters of `GET /todos` |
| `src/search.mjs` | matching a title against a search text |
| `src/summary.mjs` | the counts of `GET /summary` |
| `src/dates.mjs` | dates as `YYYY-MM-DD` strings in UTC |
| `src/storage.mjs` | the data file: reading, checking and saving it |

Unit tests are in `test/unit/`; tests that go through HTTP are in
`test/integration/`, so a fast gate can run the first alone.

- `briefs/` – task briefs; `.claude/agents/implementer.md` implements one.
- `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json` – the kit's governance templates, with project notes.
- `.asdk/gates.json`, `.asdk/risk-paths.json` – gates G1–G3, the merge policy and the minimum risk by changed path.
- `.asdk/verify.json`, `test/scenarios/`, `.claude/skills/verify/` – how `asdk verify run` starts the API, the scenarios it drives, and the skill that tells agents to use it.
- `.asdk/rules.json` – a rule made from a (fictional) mistake: dates compared in local time.
