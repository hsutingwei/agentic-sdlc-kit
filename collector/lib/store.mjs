// Append-only event store.
//
//   events/<YYYY-MM>/<session>.jsonl   hook events, one file per session
//   events/<YYYY-MM>/_manual.jsonl     CLI, gate and orchestration records
//
// Every event is validated against the core `event` contract before it is
// written; nothing is ever rewritten. Corrections are new events.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { usageError } from '../../core/errors.mjs';
import { validateContract } from '../../core/validate.mjs';
import { dataPath } from './paths.mjs';

export const MANUAL_STREAM = '_manual';
const STREAM = /^[A-Za-z0-9._-]+$/;

export const eventsDir = (env) => dataPath(env, 'events');

/** Builds an event with schema_version and the current time filled in; undefined fields are dropped. */
export function makeEvent(fields, now = new Date()) {
  const event = { schema_version: 1, ts: now.toISOString(), ...fields };
  // project_id may legitimately be null ("no project matched"); other empty fields are dropped.
  for (const [k, v] of Object.entries(event)) if (v === undefined || (v === null && k !== 'project_id')) delete event[k];
  if (event.data) {
    for (const [k, v] of Object.entries(event.data)) if (v === undefined) delete event.data[k];
  }
  return event;
}

export function appendEvent(env, event, stream = MANUAL_STREAM) {
  if (!STREAM.test(stream)) throw usageError(`invalid event stream name: ${stream}`);
  const check = validateContract('event', event);
  if (!check.valid) {
    const first = check.errors[0];
    throw usageError(`refusing to write an invalid event: ${first.path} ${first.message}`);
  }
  const dir = path.join(eventsDir(env), event.ts.slice(0, 7));
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, `${stream}.jsonl`), `${JSON.stringify(event)}\n`);
  return event;
}

/**
 * Reads events, oldest first. Lines that are not valid events are counted and located,
 * not thrown: one damaged line must not hide the rest of the history.
 * @param {{ streams?: string[] }} [options] only these streams (file names without .jsonl);
 *   task checks read just `_manual`, which holds every task record, and skip the much larger hook streams
 * @returns {{ events: object[], invalid: number, damaged: { file: string, line: number }[] }}
 */
export function readEvents(env, { streams } = {}) {
  const root = eventsDir(env);
  const events = [];
  const damaged = [];
  let invalid = 0;
  if (!existsSync(root)) return { events, invalid, damaged };
  const wanted = streams ? new Set(streams.map((name) => `${name}.jsonl`)) : null;
  for (const month of readdirSync(root).sort()) {
    const dir = path.join(root, month);
    let files;
    try {
      files = readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl') && (!wanted || wanted.has(f)))
        .sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const lines = readFileSync(path.join(dir, file), 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (line.trim() === '') return;
        let event = null;
        try {
          event = JSON.parse(line);
        } catch {
          // counted below
        }
        if (event && validateContract('event', event).valid) {
          events.push(event);
        } else {
          invalid++;
          damaged.push({ file: `${month}/${file}`, line: index + 1 });
        }
      });
    }
  }
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { events, invalid, damaged };
}
