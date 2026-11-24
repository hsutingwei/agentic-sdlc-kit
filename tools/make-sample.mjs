#!/usr/bin/env node
// Regenerates examples/sample-report/ from fictional data (see tools/lib/sample.mjs).
//
// Usage: node tools/make-sample.mjs [output directory]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSample } from './lib/sample.mjs';

const DEFAULT_OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'sample-report');
const out = path.resolve(process.argv[2] ?? DEFAULT_OUT);
const report = makeSample(out);
const a = report.aggregate;
console.log(`${report.rows.length} fictional tasks; efficiency ${a.efficiency}× over ${a.tasks} Complete task(s)`);
for (const f of Object.values(report.files)) console.log(`  ${f}`);
