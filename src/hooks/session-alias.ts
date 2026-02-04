/**
 * Session Alias Registration
 *
 * Automatically registers project aliases during session initialization.
 * When a project is identified by git remote (e.g., 'github.com/user/repo'),
 * the folder basename is registered as an alias for backwards compatibility
 * with observations stored under the old naming convention.
 *
 * @see docs/plans/agents/specs/task-1.5.spec.md
 */

import type { Database } from 'bun:sqlite';
import path from 'path';
import { registerProjectAlias } from '../services/sqlite/project-aliases.js';
import { logger } from '../utils/logger.js';

/**
 * Register project alias during session initialization.
 *
 * If the current project is identified by git remote, also register
 * the folder basename as an alias for backwards compatibility.
 *
 * This function is non-blocking: if registration fails, the session
 * continues normally. Errors are logged but not thrown.
 *
 * @param db - Database instance
 * @param cwd - Current working directory
 * @param projectId - The project identifier (git remote or basename)
 */
export function registerSessionAlias(
  db: Database,
  cwd: string | null | undefined,
  projectId: string | null | undefined
): void {
  // Guard: require valid cwd and projectId
  if (!cwd || !projectId) {
    return;
  }

  try {
    const basename = path.basename(cwd);

    // If project ID is different from basename, it's likely a git remote ID
    // Register the basename as an alias for backwards compatibility
    // Git remote IDs contain '/' (e.g., 'github.com/user/repo')
    if (projectId.includes('/') && basename && projectId !== basename) {
      const isNew = registerProjectAlias(db, basename, projectId);
      if (isNew) {
        logger.debug('SESSION', 'Registered project alias', {
          basename,
          projectId
        });
      }
    }
  } catch (error) {
    // Non-blocking: don't fail session if alias registration fails
    logger.warn('SESSION', 'Failed to register project alias', {
      cwd,
      projectId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
