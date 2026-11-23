#!/usr/bin/env node
// Creates a demo repository from examples/demo-api and registers it with the collector.
//
// Usage: node tools/demo-setup.mjs <empty or new directory> [--id <project id>]

import { parse } from '../core/cli.mjs';
import { AsdkError, usageError } from '../core/errors.mjs';
import { setupDemo } from './lib/demo.mjs';

const USAGE = 'node tools/demo-setup.mjs <directory> [--id <project id>]';

try {
  const { values, positionals } = parse(process.argv.slice(2), { id: { type: 'string' } }, { positionals: 1, usage: USAGE });
  if (positionals.length !== 1) throw usageError(`usage: ${USAGE}`);
  const demo = setupDemo(process.env, { target: positionals[0], id: values.id });
  console.log(
    [
      `demo repository: ${demo.root}`,
      `registered as:   ${demo.id}`,
      `hook settings:   ${demo.settings}`,
      '',
      'next:',
      `  cd "${demo.root}"`,
      '  asdk task start DEMO-001 --type feature --risk low --estimate 6 --title "Add due dates to todo items"',
      '  asdk wt new DEMO-001 --slug due-date',
      '(see docs/demo.md for the full walk-through)',
    ].join('\n'),
  );
} catch (err) {
  if (!(err instanceof AsdkError)) throw err;
  console.error(`demo-setup: ${err.message}`);
  process.exitCode = err.exitCode;
}
