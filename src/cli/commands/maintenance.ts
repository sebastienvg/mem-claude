/**
 * Maintenance CLI Command Functions (Task 4.2)
 *
 * Core functions for system maintenance operations via CLI.
 * Handles cleanup of old aliases, audit logs, and reports agent health.
 *
 * Usage:
 *   import { runMaintenance, formatMaintenanceReport } from './maintenance.js';
 *
 *   const report = await runMaintenance(db, {
 *     aliasMaxAgeDays: 365,
 *     auditMaxAgeDays: 90,
 *     dryRun: true
 *   });
 *   console.log(formatMaintenanceReport(report));
 */

import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

/**
 * Options for maintenance operations
 */
export interface MaintenanceOptions {
  /** Days before alias cleanup (default: 365) */
  aliasMaxAgeDays: number;
  /** Days before audit log cleanup (default: 90) */
  auditMaxAgeDays: number;
  /** Preview without deleting (default: false) */
  dryRun: boolean;
}

/**
 * Result of maintenance operations
 */
export interface MaintenanceReport {
  aliases: {
    total: number;
    olderThan: number;
    deleted: number;
  };
  auditLogs: {
    total: number;
    olderThan: number;
    deleted: number;
  };
  agents: {
    total: number;
    verified: number;
    locked: number;
    expiredKeys: number;
  };
  dryRun: boolean;
}

/**
 * Run maintenance operations: cleanup old data and collect stats.
 *
 * @param db - Database instance
 * @param options - Maintenance options
 * @returns Maintenance report with counts and stats
 */
export async function runMaintenance(
  db: Database,
  options: MaintenanceOptions
): Promise<MaintenanceReport> {
  const { aliasMaxAgeDays, auditMaxAgeDays, dryRun } = options;
  const now = Math.floor(Date.now() / 1000);

  // Calculate cutoff epochs
  const aliasCutoff = now - (aliasMaxAgeDays * 86400);
  const auditCutoff = now - (auditMaxAgeDays * 86400);

  // Alias stats
  const aliasTotal = (db.query(`SELECT COUNT(*) as c FROM project_aliases`).get() as { c: number }).c;
  const aliasOld = (db.query(`SELECT COUNT(*) as c FROM project_aliases WHERE created_at_epoch < ?`).get(aliasCutoff) as { c: number }).c;

  // Audit log stats
  const auditTotal = (db.query(`SELECT COUNT(*) as c FROM audit_log`).get() as { c: number }).c;
  const auditOld = (db.query(`SELECT COUNT(*) as c FROM audit_log WHERE created_at_epoch < ?`).get(auditCutoff) as { c: number }).c;

  // Agent stats
  const agentTotal = (db.query(`SELECT COUNT(*) as c FROM agents`).get() as { c: number }).c;
  const agentVerified = (db.query(`SELECT COUNT(*) as c FROM agents WHERE verified = 1`).get() as { c: number }).c;
  const agentLocked = (db.query(`SELECT COUNT(*) as c FROM agents WHERE locked_until_epoch > ?`).get(now) as { c: number }).c;
  const agentExpired = (db.query(`SELECT COUNT(*) as c FROM agents WHERE expires_at_epoch < ? AND expires_at_epoch IS NOT NULL`).get(now) as { c: number }).c;

  let aliasDeleted = 0;
  let auditDeleted = 0;

  if (!dryRun) {
    // Delete old aliases
    const aliasResult = db.run(`DELETE FROM project_aliases WHERE created_at_epoch < ?`, [aliasCutoff]);
    aliasDeleted = aliasResult.changes;

    // Delete old audit logs
    const auditResult = db.run(`DELETE FROM audit_log WHERE created_at_epoch < ?`, [auditCutoff]);
    auditDeleted = auditResult.changes;

    logger.info('DB', 'Maintenance cleanup completed', {
      aliasDeleted,
      auditDeleted,
      aliasMaxAgeDays,
      auditMaxAgeDays
    });
  } else {
    logger.debug('DB', 'Maintenance dry run completed', {
      aliasWouldDelete: aliasOld,
      auditWouldDelete: auditOld,
      aliasMaxAgeDays,
      auditMaxAgeDays
    });
  }

  return {
    aliases: {
      total: aliasTotal,
      olderThan: aliasOld,
      deleted: dryRun ? 0 : aliasDeleted,
    },
    auditLogs: {
      total: auditTotal,
      olderThan: auditOld,
      deleted: dryRun ? 0 : auditDeleted,
    },
    agents: {
      total: agentTotal,
      verified: agentVerified,
      locked: agentLocked,
      expiredKeys: agentExpired,
    },
    dryRun,
  };
}

/**
 * Format maintenance report for console output.
 *
 * @param report - Maintenance report to format
 * @returns Formatted string for console display
 */
export function formatMaintenanceReport(report: MaintenanceReport): string {
  const lines = [
    'Claude-mem Maintenance Report',
    '=============================',
    '',
    'Aliases:',
    `  - Total: ${report.aliases.total}`,
    `  - Older than threshold: ${report.aliases.olderThan}`,
  ];

  if (report.dryRun) {
    lines.push(`  - [DRY RUN] Would delete: ${report.aliases.olderThan}`);
  } else {
    lines.push(`  - Deleted: ${report.aliases.deleted}`);
  }

  lines.push(
    '',
    'Audit Logs:',
    `  - Total: ${report.auditLogs.total}`,
    `  - Older than threshold: ${report.auditLogs.olderThan}`,
  );

  if (report.dryRun) {
    lines.push(`  - [DRY RUN] Would delete: ${report.auditLogs.olderThan}`);
  } else {
    lines.push(`  - Deleted: ${report.auditLogs.deleted}`);
  }

  lines.push(
    '',
    'Agents:',
    `  - Total: ${report.agents.total}`,
    `  - Verified: ${report.agents.verified}`,
    `  - Currently locked: ${report.agents.locked}`,
    `  - Expired keys: ${report.agents.expiredKeys}`,
  );

  if (report.dryRun) {
    lines.push('', 'Run without --dry-run to perform cleanup.');
  }

  return lines.join('\n');
}
