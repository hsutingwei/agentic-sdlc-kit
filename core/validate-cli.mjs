#!/usr/bin/env node
// Validates a JSON or JSONL file against one of the kit's contracts.
// Any agent or script, whatever tool runs it, can check its own output with this.
//
// Usage: node core/validate-cli.mjs <contract> <file> [--jsonl]
//        node core/validate-cli.mjs --list
// Exit codes: 0 valid, 1 invalid, 2 usage or I/O error.

import { readFileSync } from 'node:fs';
import { listContracts, SchemaError, validateContract } from './validate.mjs';

const USAGE = 'usage: node core/validate-cli.mjs <contract> <file> [--jsonl] | --list';
const args = process.argv.slice(2);

if (args.length === 1 && args[0] === '--list') {
  console.log(listContracts().join('\n'));
  process.exit(0);
}

const jsonl = args.includes('--jsonl');
const positional = args.filter((a) => a !== '--jsonl');
if (positional.length !== 2 || positional.some((a) => a.startsWith('--'))) {
  console.error(USAGE);
  process.exit(2);
}
const [contract, file] = positional;

let text;
try {
  text = readFileSync(file, 'utf8').replace(/^﻿/, '');
} catch (err) {
  console.error(`validate: cannot read ${file}: ${err.message}`);
  process.exit(2);
}

const documents = jsonl
  ? text
      .split(/\r?\n/)
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter((d) => d.text.trim() !== '')
  : [{ line: null, text }];

let invalid = 0;
for (const doc of documents) {
  const where = doc.line === null ? file : `${file}:${doc.line}`;
  let value;
  try {
    value = JSON.parse(doc.text);
  } catch (err) {
    invalid++;
    console.error(`${where}: not valid JSON: ${err.message}`);
    continue;
  }
  let result;
  try {
    result = validateContract(contract, value);
  } catch (err) {
    if (err instanceof SchemaError) {
      console.error(`validate: ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
  if (!result.valid) {
    invalid++;
    for (const e of result.errors) console.error(`${where}: ${e.path} ${e.message}`);
  }
}

if (invalid === 0) {
  console.log(`valid: ${file} (${documents.length} ${documents.length === 1 ? 'document' : 'documents'}, ${contract})`);
  process.exit(0);
}
process.exit(1);
