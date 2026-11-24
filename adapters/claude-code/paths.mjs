// Where Claude Code keeps its files: $CLAUDE_CONFIG_DIR, or ~/.claude.

import path from 'node:path';
import { homeDir } from '../../collector/lib/paths.mjs';

export function claudeConfigDir(env = process.env) {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(homeDir(env), '.claude');
}

/** Transcripts: <config>/projects/<encoded working directory>/<session>.jsonl (docs/spike, finding 7). */
export const projectsDir = (env) => path.join(claudeConfigDir(env), 'projects');
