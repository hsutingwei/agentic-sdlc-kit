// Where the collector keeps its data. Everything lives under one directory so it
// can be backed up, inspected or deleted as a whole.

import os from 'node:os';
import path from 'node:path';

export function homeDir(env = process.env) {
  const fromEnv = process.platform === 'win32' ? env.USERPROFILE : env.HOME;
  return fromEnv && fromEnv.trim() !== '' ? fromEnv : os.homedir();
}

/** ~/.agentic-metrics, or AGENTIC_METRICS_HOME when set. */
export function metricsHome(env = process.env) {
  const configured = env.AGENTIC_METRICS_HOME;
  return configured && configured.trim() !== '' ? path.resolve(configured.trim()) : path.join(homeDir(env), '.agentic-metrics');
}

export const dataPath = (env, ...parts) => path.join(metricsHome(env), ...parts);

/** Expands a leading ~ to the user's home directory. */
export function expandHome(p, env = process.env) {
  if (p === '~') return homeDir(env);
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(homeDir(env), p.slice(2));
  return p;
}
