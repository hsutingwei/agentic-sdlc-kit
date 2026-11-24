// asdk report [--harvest] [--out <dir>] [--json]

import path from 'node:path';
import { parse } from '../../core/cli.mjs';
import { writeReports } from '../lib/report.mjs';
import { deriveSessions } from '../lib/sessions.mjs';
import { readEvents } from '../lib/store.mjs';

const USAGE = 'asdk report [--harvest] [--out <dir>] [--json]';

export async function runReport(argv, { env, cwd, out, err }) {
  const { values } = parse(argv, { harvest: { type: 'boolean' }, out: { type: 'string' }, json: { type: 'boolean' } }, { usage: USAGE });
  if (values.harvest) {
    // Transcript formats belong to the adapters; Claude Code is the only one so far.
    const { harvestSessions } = await import('../../adapters/claude-code/harvest-cli.mjs');
    const results = harvestSessions(env, deriveSessions(readEvents(env).events).map((s) => s.session_id));
    for (const r of results.filter((x) => x.status === 'failed')) err(`warning: could not harvest ${r.session_id}: ${r.error}`);
  }
  const report = writeReports(env, values.out ? { outDir: path.resolve(cwd, values.out) } : {});
  if (values.json) {
    out(JSON.stringify({ files: report.files, invalid_lines: report.invalid, aggregate: report.aggregate, coverage: report.coverage, rows: report.rows }, null, 2));
    return 0;
  }
  const { aggregate: a } = report;
  out(`${report.rows.length} task(s); efficiency ${a.efficiency === null ? 'not computable yet' : `${a.efficiency}× over ${a.tasks} Complete task(s)`}`);
  for (const f of Object.values(report.files)) out(`  ${f}`);
  if (report.invalid > 0) err(`warning: ${report.invalid} event line(s) could not be read`);
  return 0;
}
