import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox } from '../../test/helpers/sandbox.mjs';
import { copyDir } from '../fs.mjs';

test('copyDir copies a tree into a new CJK destination, including dot files', (t) => {
  const sb = createSandbox(t, 'copydir');
  const src = sb.join('來源 目錄');
  mkdirSync(path.join(src, '.claude', 'agents'), { recursive: true });
  writeFileSync(path.join(src, '說明.md'), '# 說明\n');
  writeFileSync(path.join(src, '.claude', 'agents', 'implementer.md'), 'agent\n');

  const dest = sb.join('目的 地', '示範 專案'); // parent does not exist yet
  copyDir(src, dest);
  assert.deepEqual(readdirSync(dest).sort(), ['.claude', '說明.md']);
  assert.equal(readFileSync(path.join(dest, '說明.md'), 'utf8'), '# 說明\n');
  assert.equal(readFileSync(path.join(dest, '.claude', 'agents', 'implementer.md'), 'utf8'), 'agent\n');
});
