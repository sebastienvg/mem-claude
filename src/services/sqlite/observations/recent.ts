/**
 * Recent observation retrieval functions
 * Extracted from SessionStore.ts for modular organization
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../../utils/logger.js';
import type { RecentObservationRow, AllRecentObservationRow } from './types.js';
import { getProjectsWithAliases } from '../project-aliases.js';

/**
 * Get recent observations for a project (includes aliased projects)
 */
export function getRecentObservations(
  db: Database,
  project: string,
  limit: number = 20
): RecentObservationRow[] {
  // Expand project to include aliases
  const projects = getProjectsWithAliases(db, project);

  // Build parameterized IN clause
  const placeholders = projects.map(() => '?').join(', ');

  const stmt = db.prepare(`
    SELECT type, text, prompt_number, created_at
    FROM observations
    WHERE project IN (${placeholders})
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `);

  return stmt.all(...projects, limit) as RecentObservationRow[];
}

/**
 * Get recent observations across all projects (for web UI)
 */
export function getAllRecentObservations(
  db: Database,
  limit: number = 100
): AllRecentObservationRow[] {
  const stmt = db.prepare(`
    SELECT id, type, title, subtitle, text, project, prompt_number, created_at, created_at_epoch
    FROM observations
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `);

  return stmt.all(limit) as AllRecentObservationRow[];
}
