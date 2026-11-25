// .asdk/review.json: how reviewer agents write and whether their findings are proven.
// Read from the main checkout on the integration branch, like the gates: a task branch
// cannot change how it is reviewed.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { usageError } from '../../core/errors.mjs';

export const REVIEW_FILE = path.join('.asdk', 'review.json');
export const REVIEW_DEFAULTS = Object.freeze({ language: 'en', prove: true, proof_timeout_s: 60, reviewer_timeout_minutes: 10 });

const KNOWN = new Set(['schema_version', ...Object.keys(REVIEW_DEFAULTS)]);

export function loadReviewConfig(top) {
  const file = path.join(top, REVIEW_FILE);
  if (!existsSync(file)) return { ...REVIEW_DEFAULTS };
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (err) {
    throw usageError(`${REVIEW_FILE} is not valid JSON: ${err.message}`);
  }
  const fail = (msg) => {
    throw usageError(`${REVIEW_FILE}: ${msg}`);
  };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('must be an object');
  if (raw.schema_version !== 1) fail('schema_version must be 1');
  for (const k of Object.keys(raw)) if (!KNOWN.has(k)) fail(`unknown setting "${k}"`);
  const c = { ...REVIEW_DEFAULTS, ...raw };
  delete c.schema_version;
  if (typeof c.language !== 'string' || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(c.language)) fail('language must be a language tag such as en or zh-TW');
  if (typeof c.prove !== 'boolean') fail('prove must be true or false');
  if (!Number.isInteger(c.proof_timeout_s) || c.proof_timeout_s < 5 || c.proof_timeout_s > 600) fail('proof_timeout_s must be a whole number from 5 to 600');
  if (!Number.isInteger(c.reviewer_timeout_minutes) || c.reviewer_timeout_minutes < 1 || c.reviewer_timeout_minutes > 60) fail('reviewer_timeout_minutes must be a whole number from 1 to 60');
  return c;
}
