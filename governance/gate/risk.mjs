// Minimum risk by changed path (.asdk/risk-paths.json in the project).
//
// The gate compares the commit it verifies with the integration branch, and the
// highest risk among the matching rules becomes the path minimum. The effective
// risk is the higher of that and the risk the task declared: paths can raise a
// task's risk, never lower it.
//
//   { "schema_version": 1,
//     "rules": [ { "paths": ["src/server.mjs"], "risk": "medium", "reason": "public HTTP contract" } ] }

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { usageError } from '../../core/errors.mjs';
import { matchesGlob } from '../../core/glob.mjs';
import { git } from '../../core/git.mjs';
import { RISKS } from '../../collector/lib/tasks.mjs';

export const RISK_FILE = path.join('.asdk', 'risk-paths.json');

const rank = (risk) => RISKS.indexOf(risk);
export const higherRisk = (a, b) => (rank(a) >= rank(b) ? a : b);

/** The rules of a project; an empty list when it has no risk-paths file. */
export function loadRiskPaths(top) {
  const file = path.join(top, RISK_FILE);
  if (!existsSync(file)) return [];
  const fail = (msg) => {
    throw usageError(`${RISK_FILE}: ${msg}`);
  };
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    fail(`not valid JSON: ${err.message}`);
  }
  if (!config || !Array.isArray(config.rules)) fail('"rules" must be an array');
  config.rules.forEach((rule, i) => {
    if (!Array.isArray(rule.paths) || rule.paths.length === 0 || !rule.paths.every((p) => typeof p === 'string' && p !== '')) fail(`rule ${i + 1}: "paths" must be a non-empty list of globs`);
    if (rule.paths.some((p) => p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split(/[\\/]/).includes('..'))) fail(`rule ${i + 1}: paths are repository-relative, without ".."`);
    if (!RISKS.includes(rule.risk)) fail(`rule ${i + 1}: "risk" must be one of ${RISKS.join(', ')}`);
  });
  return config.rules;
}

/** Files that differ between the merge base of `base` and `head`, and `head`. Renames count as both paths. */
export function changedPaths(top, env, { base, head }) {
  if (!base || base === head) return [];
  return git(['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`], { cwd: top, env }).split('\0').filter(Boolean);
}

/**
 * The minimum risk the changed files call for.
 * @returns {{ risk: string, matches: Array<{ path: string, risk: string, reason?: string }> }}
 */
export function pathMinimum(rules, files) {
  let risk = 'low';
  const matches = [];
  for (const file of files) {
    let best = null;
    for (const rule of rules) {
      if (rule.paths.some((glob) => matchesGlob(file, glob)) && (!best || rank(rule.risk) > rank(best.risk))) best = rule;
    }
    if (best && best.risk !== 'low') {
      matches.push({ path: file, risk: best.risk, ...(best.reason ? { reason: best.reason } : {}) });
      risk = higherRisk(risk, best.risk);
    }
  }
  return { risk, matches };
}
