# demo-api

A tiny, fictional todo-list REST API used as the target project for the
agentic-sdlc-kit demos. It uses `node:http` only and keeps data in memory.

| Method | Path | Result |
|---|---|---|
| GET | `/todos` | all items |
| POST | `/todos` | create `{ "title": "..." }` → 201 |
| GET | `/todos/:id` | one item or 404 |
| PATCH | `/todos/:id` | update `title` and/or `done` |
| DELETE | `/todos/:id` | 204 or 404 |

```sh
npm start   # http://127.0.0.1:3000
npm test
```

Unit tests of the store are in `test/unit/`; tests that go through HTTP are in
`test/integration/`, so a fast gate can run the first alone.

- `briefs/DEMO-001.json` – the task brief for the first demo task (due dates).
- `.claude/agents/implementer.md` – the sub-agent that implements a brief.

`tools/demo-setup.mjs` in the kit copies this directory into a separate git
repository, so the demo never changes the kit's own repository.
