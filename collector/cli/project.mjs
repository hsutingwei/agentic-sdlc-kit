// asdk project add|remove|list   and   asdk resolve [path]

import path from 'node:path';
import { parse } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { loadConfig, registerProject, removeProject, resolveProject } from '../lib/registry.mjs';

const ADD_USAGE = 'asdk project add <id> <root> [--copy-file <relative path>]...';

export async function runProject(argv, { env, out }) {
  const [sub, ...rest] = argv;
  if (sub === 'add') {
    const { values, positionals } = parse(rest, { 'copy-file': { type: 'string', multiple: true } }, { positionals: 2, usage: ADD_USAGE });
    if (positionals.length !== 2) throw usageError(`usage: ${ADD_USAGE}`);
    const entry = registerProject(env, { id: positionals[0], root: path.resolve(positionals[1]), copyFiles: values['copy-file'] ?? [] });
    out(`registered ${entry.id} -> ${entry.root}`);
    return 0;
  }
  if (sub === 'remove') {
    const { positionals } = parse(rest, {}, { positionals: 1, usage: 'asdk project remove <id>' });
    if (positionals.length !== 1) throw usageError('usage: asdk project remove <id>');
    const entry = removeProject(env, positionals[0]);
    out(`removed ${entry.id} (${entry.root}); its recorded events are kept`);
    return 0;
  }
  if (sub === 'list') {
    parse(rest, {}, { usage: 'asdk project list' });
    for (const p of loadConfig(env).projects) out(`${p.id}\t${p.root}`);
    return 0;
  }
  throw usageError('usage: asdk project add <id> <root> | asdk project remove <id> | asdk project list');
}

export async function runResolve(argv, { env, cwd, out }) {
  const usage = 'asdk resolve [path] [--json]';
  const { values, positionals } = parse(argv, { json: { type: 'boolean' } }, { positionals: 1, usage });
  const result = resolveProject(path.resolve(cwd, positionals[0] ?? '.'), { env });
  if (values.json) out(JSON.stringify(result));
  else if (result.project_id) out(`${result.project_id} (${result.project_source}${result.worktree ? `, worktree ${result.worktree}` : ''})`);
  else out('none');
  return 0;
}
