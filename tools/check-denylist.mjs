#!/usr/bin/env node
// Blocks a commit when staged content matches the user's private keyword list.
// List format (keywords, re: regex rules, warn: rules): see tools/lib/denylist.mjs.
//
// Usage: node tools/check-denylist.mjs [--staged | --tracked]
//   --staged   scan the index, as the pre-commit hook does (default)
//   --tracked  scan every tracked file in the working tree
// Exit codes: 0 clean or skipped, 1 matches found, 2 configuration or git error.

import { EXIT, runCheck } from './lib/denylist.mjs';

const args = process.argv.slice(2);
const known = new Set(['--staged', '--tracked']);
const unknown = args.filter((a) => !known.has(a));
if (unknown.length > 0 || (args.includes('--staged') && args.includes('--tracked'))) {
  console.error('usage: node tools/check-denylist.mjs [--staged | --tracked]');
  process.exit(EXIT.CONFIG);
}

process.exitCode = runCheck({ cwd: process.cwd(), mode: args.includes('--tracked') ? 'tracked' : 'staged' });
