/**
 * Auto Memory Path Resolver
 *
 * Resolves paths to Claude Code's auto memory directory.
 * Located at: ~/.claude/projects/<encoded-path>/memory/MEMORY.md
 *
 * Encoding rules (from research):
 * - Forward slashes → dashes
 * - Dots → dashes
 * - Truncated at 89 characters
 * - Based on CWD (not git root)
 */

import { join } from 'path';
import { homedir } from 'os';

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const MAX_ENCODED_LENGTH = 89;

/**
 * Encode an absolute project path into Claude Code's directory-name format.
 */
export function encodeProjectPath(absolutePath: string): string {
  let encoded = absolutePath.replace(/\//g, '-').replace(/\./g, '-');
  if (encoded.length > MAX_ENCODED_LENGTH) {
    encoded = encoded.substring(0, MAX_ENCODED_LENGTH);
  }
  return encoded;
}

/**
 * Get the auto memory directory for a project.
 */
export function getAutoMemoryDir(projectPath: string): string {
  return join(CLAUDE_DIR, 'projects', encodeProjectPath(projectPath), 'memory');
}

/**
 * Get the full path to MEMORY.md for a project.
 */
export function getAutoMemoryFilePath(projectPath: string): string {
  return join(getAutoMemoryDir(projectPath), 'MEMORY.md');
}
