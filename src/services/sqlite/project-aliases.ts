/**
 * Project Alias Resolution Service
 *
 * Manages project aliases for backwards compatibility when migrating
 * from folder-basename identifiers to git-remote-based identifiers.
 *
 * Usage:
 *   import {
 *     registerProjectAlias,
 *     getProjectsWithAliases,
 *     cleanupOldAliases,
 *     MAX_ALIASES_IN_QUERY
 *   } from './project-aliases.js';
 *
 *   // Register: maps old basename to new git remote ID
 *   registerProjectAlias(db, 'claude-mem', 'github.com/user/claude-mem');
 *
 *   // Query: get all identifiers for a project
 *   const projects = getProjectsWithAliases(db, 'github.com/user/claude-mem');
 *   // Returns: ['github.com/user/claude-mem', 'claude-mem']
 */

import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

/** Maximum aliases to include in IN clause (SQLite limit is 999) */
export const MAX_ALIASES_IN_QUERY = 100;

/**
 * Register a project alias mapping.
 *
 * @param db - Database instance
 * @param oldProject - The old folder-based project name
 * @param newProject - The new git-remote-based identifier
 * @returns true if new alias was created, false if already exists or same
 */
export function registerProjectAlias(
  db: Database,
  oldProject: string,
  newProject: string
): boolean {
  // Skip if old and new are the same
  if (oldProject === newProject) {
    return false;
  }

  try {
    const result = db.run(`
      INSERT OR IGNORE INTO project_aliases (old_project, new_project)
      VALUES (?, ?)
    `, [oldProject, newProject]);

    if (result.changes > 0) {
      logger.debug('DB', 'Registered new project alias', {
        old: oldProject,
        new: newProject
      });
      return true;
    }

    return false;
  } catch (error) {
    logger.error('DB', 'Failed to register project alias', {
      old: oldProject,
      new: newProject
    }, error);
    return false;
  }
}

/**
 * Get all project identifiers that should be queried for a given project.
 *
 * IMPORTANT: Limited to MAX_ALIASES_IN_QUERY to avoid SQLite parameter limits.
 * If a project has more aliases, logs warning and returns truncated list.
 *
 * @param db - Database instance
 * @param project - The current project identifier
 * @returns Array of project identifiers including aliases, with input project first
 */
export function getProjectsWithAliases(db: Database, project: string): string[] {
  const projects = [project];

  try {
    const aliases = db.query(`
      SELECT old_project FROM project_aliases
      WHERE new_project = ?
      LIMIT ?
    `).all(project, MAX_ALIASES_IN_QUERY) as { old_project: string }[];

    for (const alias of aliases) {
      projects.push(alias.old_project);
    }

    // Warn if we hit the limit
    if (aliases.length === MAX_ALIASES_IN_QUERY) {
      const totalCount = getAliasCount(db, project);
      if (totalCount > MAX_ALIASES_IN_QUERY) {
        logger.warn('DB', 'Alias count exceeds query limit', {
          project,
          totalAliases: totalCount,
          includedInQuery: MAX_ALIASES_IN_QUERY,
          recommendation: 'Run cleanup to consolidate old aliases'
        });
      }
    }
  } catch (error) {
    logger.error('DB', 'Failed to get project aliases', { project }, error);
  }

  return projects;
}

/**
 * Get count of aliases for a project.
 *
 * @param db - Database instance
 * @param project - The project identifier (new_project in the alias table)
 * @returns Total count of aliases for the project
 */
export function getAliasCount(db: Database, project: string): number {
  try {
    const result = db.query(`
      SELECT COUNT(*) as count FROM project_aliases WHERE new_project = ?
    `).get(project) as { count: number };
    return result.count;
  } catch {
    return 0;
  }
}

/**
 * Cleanup old aliases (for maintenance).
 * Removes aliases older than specified days.
 *
 * @param db - Database instance
 * @param olderThanDays - Delete aliases older than this many days (default: 365)
 * @returns Number of deleted rows
 */
export function cleanupOldAliases(db: Database, olderThanDays: number = 365): number {
  const cutoffEpoch = Math.floor(Date.now() / 1000) - (olderThanDays * 86400);

  try {
    const result = db.run(`
      DELETE FROM project_aliases WHERE created_at_epoch < ?
    `, [cutoffEpoch]);

    logger.info('DB', 'Cleaned up old project aliases', {
      deleted: result.changes,
      olderThanDays
    });

    return result.changes;
  } catch (error) {
    logger.error('DB', 'Failed to cleanup project aliases', undefined, error);
    return 0;
  }
}
