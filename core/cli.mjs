// Small helpers shared by the command modules behind bin/asdk.mjs.

import { parseArgs } from 'node:util';
import { usageError } from './errors.mjs';

/**
 * parseArgs with errors turned into usage errors.
 * @param {string[]} argv
 * @param {Record<string, { type: 'string' | 'boolean', multiple?: boolean }>} options
 */
export function parse(argv, options, { positionals = 0, usage }) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: positionals > 0, strict: true });
  } catch (err) {
    throw usageError(`${err.message}\nusage: ${usage}`);
  }
  if (parsed.positionals.length > positionals) throw usageError(`too many arguments\nusage: ${usage}`);
  return parsed;
}

export function requireOption(values, name, usage) {
  if (values[name] === undefined || values[name] === '') throw usageError(`--${name} is required\nusage: ${usage}`);
  return values[name];
}

export function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw usageError(`${label} must be one of: ${allowed.join(', ')} (got "${value}")`);
  return value;
}
