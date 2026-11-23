// File-system helpers that behave the same on every supported Node version.

import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Recursively copies regular files and directories from `src` into `dest`
 * (created if missing). Symbolic links are skipped.
 *
 * fs.cpSync is avoided on purpose: in CI on Windows with Node 22, copying into a
 * destination whose path contains CJK characters left no directory under that
 * name (git then failed with ENOENT there), while Node 24 and Linux were fine.
 * readdir, mkdir and copyFile handle such paths on every runner we test.
 */
export function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}
