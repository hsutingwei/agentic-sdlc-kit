import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesGlob } from '../glob.mjs';

test('globs match repository paths the way briefs write them', () => {
  const cases = [
    ['src/**', 'src/todos.mjs', true],
    ['src/**', 'src/db/migrations/001.sql', true],
    ['src/**', 'srcs/x.mjs', false],
    ['src/*.mjs', 'src/todos.mjs', true],
    ['src/*.mjs', 'src/db/x.mjs', false],
    ['**/.env', '.env', true],
    ['**/.env', 'config/prod/.env', true],
    ['**/.env', 'config/.env.example', false],
    ['test/**/*.test.mjs', 'test/unit/todos.test.mjs', true],
    ['test/**/*.test.mjs', 'test/todos.test.mjs', true],
    ['db/migration-??.sql', 'db/migration-01.sql', true],
    ['db/migration-??.sql', 'db/migration-1.sql', false],
    ['文件/說明 (草稿).md', '文件/說明 (草稿).md', true],
    ['a+b/[x].mjs', 'a+b/[x].mjs', true],
    ['SRC/**', 'src/x.mjs', false],
  ];
  for (const [glob, file, expected] of cases) assert.equal(matchesGlob(file, glob), expected, `${glob} vs ${file}`);
  assert.equal(matchesGlob('src\\db\\x.mjs', 'src/db/*.mjs'), true);
});
