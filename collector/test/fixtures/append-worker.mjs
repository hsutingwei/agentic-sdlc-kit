// Appends `count` events to one shared stream, as parallel hook processes do.
// Usage: node append-worker.mjs <worker> <count> <stream>
import { appendEvent, makeEvent } from '../../lib/store.mjs';

const [worker, count, stream] = process.argv.slice(2);
// About 1.7 KB per line, so a torn write would show up as a broken line.
const padding = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`pad_${i}`, `${worker}`.repeat(200)]));
for (let seq = 0; seq < Number(count); seq++) {
  appendEvent(process.env, makeEvent({ source: 'hook', event: 'PreToolUse', session_id: stream, project_id: null, data: { worker: Number(worker), seq, ...padding } }), stream);
}
