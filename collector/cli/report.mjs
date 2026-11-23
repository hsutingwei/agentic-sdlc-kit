// asdk report [--json]

import { parse } from '../../core/cli.mjs';
import { writeReports } from '../lib/report.mjs';

export async function runReport(argv, { env, out }) {
  const { values } = parse(argv, { json: { type: 'boolean' } }, { usage: 'asdk report [--json]' });
  const { rows, files, invalid } = writeReports(env);
  if (values.json) {
    out(JSON.stringify({ files, invalid_lines: invalid, rows }, null, 2));
    return 0;
  }
  out(`${rows.length} task(s)`);
  out(`  ${files.csv}`);
  out(`  ${files.summary}`);
  if (invalid > 0) out(`warning: ${invalid} event line(s) could not be read`);
  return 0;
}
