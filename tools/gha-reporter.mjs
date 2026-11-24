// node:test reporter that turns each failing test into a GitHub Actions
// annotation (::error). Annotations are visible on the commit and through the
// public API without signing in, unlike raw job logs.

import path from 'node:path';

const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const MAX_MESSAGE = 2000;

export function annotation(data, cwd = process.cwd()) {
  const error = data.details?.error;
  // A parent fails when a subtest fails; the subtest has its own annotation.
  if (error?.failureType === 'subtestsFailed') return null;
  const cause = error?.cause ?? error;
  let message = cause?.message ?? String(cause ?? 'test failed');
  if (cause?.stack) {
    const frame = cause.stack.split('\n').find((l) => /^\s+at .*\.test\.mjs/.test(l));
    if (frame) message += `\n${frame.trim()}`;
  }
  if (message.length > MAX_MESSAGE) message = `${message.slice(0, MAX_MESSAGE)}…`;
  const file = data.file ? path.relative(cwd, data.file).split(path.sep).join('/') : '';
  const where = file ? `file=${escapeProperty(file)},line=${data.line ?? 1},` : '';
  return `::error ${where}title=${escapeProperty(data.name ?? 'test')}::${escapeData(message)}\n`;
}

export default async function* githubAnnotations(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail') continue;
    const line = annotation(event.data);
    if (line) yield line;
  }
}
