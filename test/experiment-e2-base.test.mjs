// The starting point of the E2 tasks: the demo with the suite's base laid over
// it. It has to be a project the kit's own gates accept, with its tests passing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, makeDemoRepo } from './helpers/sandbox.mjs';
import { registerProject } from '../collector/lib/registry.mjs';
import { runGate } from '../governance/gate/gate.mjs';
import { baseFiles, commitOverlay } from '../tools/experiment/lib/catalogue.mjs';

test('E1 has no base; the E2 base only adds to src, test and the README', () => {
  assert.deepEqual(baseFiles('e1'), []);
  const files = baseFiles('e2').map((f) => f.rel);
  assert.ok(files.includes('src/storage.mjs') && files.includes('test/unit/storage.test.mjs'), files.join());
  assert.deepEqual(files.filter((f) => !/^(src|test)\//.test(f)), ['README.md']);
});

test('the demo with the E2 base passes G2, in a folder with CJK characters and a space', (t) => {
  const sb = createSandbox(t, 'e2-base');
  const repo = makeDemoRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root: repo });
  commitOverlay(sb.env, { repo, files: baseFiles('e2'), message: 'chore: the E2 starting point' });

  const gate = runGate(sb.env, { gate: 'G2', cwd: repo });
  assert.equal(gate.summary.result, 'pass', JSON.stringify(gate.outputs, null, 2));
  const unit = gate.outputs['unit tests'];
  const integration = gate.outputs['integration tests'];
  // The summary lines, whichever reporter this version of node uses when its output is captured.
  assert.match(unit, / fail 0$/m);
  assert.match(integration, / pass 3$/m);
  // The scenario of the demo still describes this API: an item it creates has the fields it expects.
  const scenario = JSON.parse(readFileSync(path.join(repo, 'test', 'scenarios', 'todos-basic.json'), 'utf8'));
  assert.deepEqual(scenario.steps[0].expect.json, { title: '寫驗證情境', done: false });
});
