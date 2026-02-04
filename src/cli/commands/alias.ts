/**
 * Alias CLI Command Functions
 *
 * Core functions for managing project aliases via CLI.
 * These are used by the scripts/alias-cli.ts entry point.
 *
 * Usage:
 *   import { listAliases, addAlias, cleanupAliases, countAliases } from './alias.js';
 */

import type { Database } from 'bun:sqlite';
import {
  registerProjectAlias,
  getAliasCount,
  cleanupOldAliases,
  MAX_ALIASES_IN_QUERY,
} from '../../services/sqlite/project-aliases.js';

export interface Alias {
  id: number;
  old_project: string;
  new_project: string;
  created_at: string;
}

export interface ListResult {
  aliases: Alias[];
  total: number;
}

export interface AddResult {
  success: boolean;
  created: boolean;
  message: string;
}

export interface CleanupResult {
  deleted: number;
  wouldDelete: number;
  dryRun: boolean;
}

export interface CountResult {
  project: string;
  count: number;
  exceedsLimit: boolean;
  limit: number;
}

/**
 * List all project aliases, optionally filtered by project.
 *
 * @param db - Database instance
 * @param project - Optional new_project to filter by
 * @returns List of aliases sorted by created_at descending
 */
export function listAliases(db: Database, project?: string): ListResult {
  let sql = `
    SELECT id, old_project, new_project, created_at
    FROM project_aliases
  `;
  const params: any[] = [];

  if (project) {
    sql += ` WHERE new_project = ?`;
    params.push(project);
  }

  sql += ` ORDER BY created_at DESC`;

  const aliases = db.query(sql).all(...params) as Alias[];

  return {
    aliases,
    total: aliases.length,
  };
}

/**
 * Add a new project alias.
 *
 * @param db - Database instance
 * @param oldProject - The old folder-based project name
 * @param newProject - The new git-remote-based identifier
 * @returns Result indicating success and whether alias was created
 */
export function addAlias(db: Database, oldProject: string, newProject: string): AddResult {
  if (!oldProject || !newProject) {
    return {
      success: false,
      created: false,
      message: 'Both old and new project names are required',
    };
  }

  if (oldProject === newProject) {
    return {
      success: false,
      created: false,
      message: 'Old and new project names must be different',
    };
  }

  const created = registerProjectAlias(db, oldProject, newProject);

  return {
    success: true,
    created,
    message: created
      ? `Alias created: ${oldProject} -> ${newProject}`
      : `Alias already exists: ${oldProject} -> ${newProject}`,
  };
}

/**
 * Cleanup old aliases.
 *
 * @param db - Database instance
 * @param options - Cleanup options
 * @param options.days - Delete aliases older than this many days
 * @param options.dryRun - If true, only count without deleting
 * @returns Result with count of deleted/would-be-deleted aliases
 */
export function cleanupAliases(
  db: Database,
  options: { days: number; dryRun: boolean }
): CleanupResult {
  const { days, dryRun } = options;
  const cutoffEpoch = Math.floor(Date.now() / 1000) - (days * 86400);

  // Count what would be deleted
  const countResult = db.query(`
    SELECT COUNT(*) as count FROM project_aliases WHERE created_at_epoch < ?
  `).get(cutoffEpoch) as { count: number };

  if (dryRun) {
    return {
      deleted: 0,
      wouldDelete: countResult.count,
      dryRun: true,
    };
  }

  const deleted = cleanupOldAliases(db, days);

  return {
    deleted,
    wouldDelete: 0,
    dryRun: false,
  };
}

/**
 * Count aliases for a project.
 *
 * @param db - Database instance
 * @param project - The project identifier (new_project in the alias table)
 * @returns Count result with limit warning if applicable
 */
export function countAliases(db: Database, project: string): CountResult {
  const count = getAliasCount(db, project);

  return {
    project,
    count,
    exceedsLimit: count > MAX_ALIASES_IN_QUERY,
    limit: MAX_ALIASES_IN_QUERY,
  };
}

/**
 * Format alias list for display.
 *
 * @param result - ListResult to format
 * @returns Formatted string for console output
 */
export function formatAliasList(result: ListResult): string {
  if (result.aliases.length === 0) {
    return 'No aliases found.';
  }

  const aliasWord = result.total === 1 ? 'alias' : 'aliases';
  const lines = [
    `Found ${result.total} ${aliasWord}:`,
    '',
    'OLD PROJECT -> NEW PROJECT (created)',
    '-'.repeat(70),
  ];

  for (const alias of result.aliases) {
    lines.push(`${alias.old_project} -> ${alias.new_project} (${alias.created_at})`);
  }

  return lines.join('\n');
}
