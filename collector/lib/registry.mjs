// Project registry: which project a working directory belongs to.
//
// config.json lists projects by id and root. A directory belongs to the project
// with the longest matching root (paths compared after resolving symlinks and,
// on Windows, ignoring case and separator style). Worktrees usually live outside
// the project root, so a directory that matches no root is traced back through
// git's common directory to the main checkout.

import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { usageError } from '../../core/errors.mjs';
import { locateRepo } from '../../core/git.mjs';
import { withCollectorLock } from './locks.mjs';
import { dataPath, expandHome, homeDir } from './paths.mjs';

const PROJECT_ID = /^[a-z][a-z0-9-]*$/;
const SLOT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export const configPath = (env) => dataPath(env, 'config.json');

export function loadConfig(env = process.env) {
  const file = configPath(env);
  if (!existsSync(file)) return { schema_version: 1, projects: [] };
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    // Never fall back to an empty config: a later save would erase the user's projects.
    throw usageError(`${file} is not valid JSON (${err.message}); fix it by hand`);
  }
  if (!Array.isArray(config.projects)) throw usageError(`${file}: "projects" must be an array`);
  for (const p of config.projects) {
    if (!PROJECT_ID.test(p?.id ?? '') || typeof p.root !== 'string') {
      throw usageError(`${file}: every project needs an id like "demo-api" and a root path`);
    }
  }
  if (config.record_unregistered !== undefined && typeof config.record_unregistered !== 'boolean') {
    throw usageError(`${file}: "record_unregistered" must be true or false`);
  }
  return config;
}

/** Whether hook events outside every registered project are kept (default true: needed for task coverage). */
export const recordsUnregistered = (config) => config.record_unregistered !== false;

export function saveConfig(env, config) {
  const file = configPath(env);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Adds or replaces a project entry. */
export function registerProject(env, { id, root, copyFiles = [] }) {
  if (!PROJECT_ID.test(id ?? '')) throw usageError(`invalid project id "${id}" (use lowercase letters, digits and -)`);
  if (!root || !path.isAbsolute(root) || !existsSync(root)) throw usageError(`project root must be an existing absolute path: ${root}`);
  for (const f of copyFiles) {
    if (path.isAbsolute(f) || f.split(/[/\\]/).includes('..')) throw usageError(`copy file must be relative to the project: ${f}`);
  }
  const entry = { id, root: path.resolve(root) };
  if (copyFiles.length > 0) entry.worktree_copy_files = copyFiles;
  // Read, change and write config.json under one lock, or parallel adds lose each other's entries.
  return withCollectorLock(env, 'config', () => {
    const config = loadConfig(env);
    config.projects = config.projects.filter((p) => p.id !== id).concat(entry);
    saveConfig(env, config);
    return entry;
  });
}

/** Removes a project entry. Recorded events keep their project_id. */
export function removeProject(env, id) {
  return withCollectorLock(env, 'config', () => {
    const config = loadConfig(env);
    const entry = findProject(config, id);
    if (!entry) throw usageError(`unknown project "${id}" (see asdk project list)`);
    config.projects = config.projects.filter((p) => p.id !== id);
    saveConfig(env, config);
    return entry;
  });
}

export function findProject(config, id) {
  return config.projects.find((p) => p.id === id) ?? null;
}

/** Canonical form for comparing paths: real path, forward slashes, no trailing slash, case-folded on Windows. */
export function normalizePath(p, platform = process.platform) {
  let resolved = path.resolve(p);
  try {
    resolved = realpathSync.native(resolved);
  } catch {
    // Not on disk (yet): compare the resolved spelling.
  }
  let out = resolved.replace(/\\/g, '/').replace(/\/+$/, '');
  if (platform === 'win32') out = out.toLowerCase();
  return out;
}

const isWithin = (child, root) => child === root || child.startsWith(`${root}/`);

/** Root under which `wt new` creates worktrees. */
export function worktreeRoot(env, config = loadConfig(env)) {
  const configured = config.worktrees?.root;
  return configured ? path.resolve(expandHome(configured, env)) : path.join(homeDir(env), 'wt');
}

/**
 * @returns {{ project_id: string|null, project_source: 'registry'|'git-common-dir'|'none', root: string|null, worktree: string|null }}
 */
export function resolveProject(cwd, { env = process.env, config = loadConfig(env) } = {}) {
  const target = normalizePath(cwd);
  const repo = locateRepo(cwd); // no git process: this runs on every hook call
  const slotOf = (root) => {
    if (!repo) return null;
    const top = normalizePath(repo.toplevel);
    if (top === normalizePath(root)) return null; // the main checkout, not a linked worktree
    const name = path.basename(repo.toplevel);
    return SLOT_NAME.test(name) ? name : null;
  };

  let best = null;
  for (const project of config.projects) {
    const root = normalizePath(project.root);
    if (isWithin(target, root) && (!best || root.length > best.root.length)) best = { project, root };
  }
  if (best) {
    return { project_id: best.project.id, project_source: 'registry', root: best.project.root, worktree: slotOf(best.project.root) };
  }

  if (repo && path.basename(repo.commonDir) === '.git') {
    const mainRoot = normalizePath(path.dirname(repo.commonDir));
    const project = config.projects.find((p) => normalizePath(p.root) === mainRoot);
    if (project) {
      return { project_id: project.id, project_source: 'git-common-dir', root: project.root, worktree: slotOf(project.root) };
    }
  }
  return { project_id: null, project_source: 'none', root: null, worktree: null };
}
