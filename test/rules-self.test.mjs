// The kit keeps its own rules: .asdk/rules.json at the repository root.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRules, loadRules, testRules } from '../governance/gate/rules.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test("the kit's own rules prove themselves and the code keeps them", () => {
  const rules = loadRules(ROOT);
  assert.ok(rules.length > 0);
  assert.deepEqual(testRules(rules).filter((r) => !r.ok), []);
  const findings = checkRules(rules, { cwd: ROOT, env: process.env });
  assert.deepEqual(findings.map((f) => `${f.file}:${f.line} [${f.id}] ${f.text}`), []);
});
