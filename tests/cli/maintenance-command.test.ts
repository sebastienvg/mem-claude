/**
 * Maintenance CLI Commands Tests (Task 4.2)
 *
 * Tests the CLI command functions for system maintenance:
 * - runMaintenance: Cleanup old aliases and audit logs
 * - formatMaintenanceReport: Format report for console output
 *
 * Sources:
 * - Task spec: docs/plans/agents/task-4.2-maintenance-cli.md
 * - Project aliases: src/services/sqlite/project-aliases.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import {
  runMaintenance,
  formatMaintenanceReport,
  type MaintenanceOptions,
  type MaintenanceReport,
} from '../../src/cli/commands/maintenance.js';
import type { Database } from 'bun:sqlite';

describe('Maintenance CLI Commands', () => {
  let db: Database;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
  });

  afterEach(() => {
    db.close();
  });

  describe('runMaintenance', () => {
    describe('dry run mode', () => {
      it('should not delete aliases on dry run', async () => {
        // Insert old alias (400 days ago)
        const oldEpoch = Math.floor(Date.now() / 1000) - (400 * 86400);
        db.run(`
          INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
          VALUES ('ancient-alias', 'github.com/old/repo', ?)
        `, [oldEpoch]);

        const options: MaintenanceOptions = {
          aliasMaxAgeDays: 365,
          auditMaxAgeDays: 90,
          dryRun: true,
        };

        const report = await runMaintenance(db, options);

        // Should report the old alias
        expect(report.aliases.olderThan).toBe(1);
        expect(report.aliases.deleted).toBe(0);
        expect(report.dryRun).toBe(true);

        // Verify alias still exists
        const count = db.query(`SELECT COUNT(*) as c FROM project_aliases WHERE old_project = 'ancient-alias'`).get() as { c: number };
        expect(count.c).toBe(1);
      });

      it('should not delete audit logs on dry run', async () => {
        // Insert old audit log (100 days ago)
        const oldEpoch = Math.floor(Date.now() / 1000) - (100 * 86400);
        db.run(`
          INSERT INTO audit_log (agent_id, action, created_at_epoch)
          VALUES ('test@host', 'old_action', ?)
        `, [oldEpoch]);

        const options: MaintenanceOptions = {
          aliasMaxAgeDays: 365,
          auditMaxAgeDays: 90,
          dryRun: true,
        };

        const report = await runMaintenance(db, options);

        // Should report the old audit log
        expect(report.auditLogs.olderThan).toBe(1);
        expect(report.auditLogs.deleted).toBe(0);
        expect(report.dryRun).toBe(true);

        // Verify audit log still exists
        const count = db.query(`SELECT COUNT(*) as c FROM audit_log WHERE action = 'old_action'`).get() as { c: number };
        expect(count.c).toBe(1);
      });
    });

    describe('actual run mode', () => {
      it('should delete old aliases', async () => {
        const now = Math.floor(Date.now() / 1000);
        // Insert old alias (400 days ago) and recent alias
        const oldEpoch = now - (400 * 86400);
        const recentEpoch = now - (30 * 86400);

        db.run(`
          INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
          VALUES ('ancient-alias', 'github.com/old/repo', ?)
        `, [oldEpoch]);
        db.run(`
          INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
          VALUES ('recent-alias', 'github.com/recent/repo', ?)
        `, [recentEpoch]);

        const options: MaintenanceOptions = {
          aliasMaxAgeDays: 365,
          auditMaxAgeDays: 90,
          dryRun: false,
        };

        const report = await runMaintenance(db, options);

        expect(report.aliases.deleted).toBe(1);
        expect(report.dryRun).toBe(false);

        // Verify old alias is gone, recent remains
        const oldCount = db.query(`SELECT COUNT(*) as c FROM project_aliases WHERE old_project = 'ancient-alias'`).get() as { c: number };
        const recentCount = db.query(`SELECT COUNT(*) as c FROM project_aliases WHERE old_project = 'recent-alias'`).get() as { c: number };
        expect(oldCount.c).toBe(0);
        expect(recentCount.c).toBe(1);
      });

      it('should delete old audit logs', async () => {
        const now = Math.floor(Date.now() / 1000);
        // Insert old audit log (100 days ago) and recent audit log
        const oldEpoch = now - (100 * 86400);
        const recentEpoch = now - (30 * 86400);

        db.run(`
          INSERT INTO audit_log (agent_id, action, created_at_epoch)
          VALUES ('test@host', 'old_action', ?)
        `, [oldEpoch]);
        db.run(`
          INSERT INTO audit_log (agent_id, action, created_at_epoch)
          VALUES ('test@host', 'recent_action', ?)
        `, [recentEpoch]);

        const options: MaintenanceOptions = {
          aliasMaxAgeDays: 365,
          auditMaxAgeDays: 90,
          dryRun: false,
        };

        const report = await runMaintenance(db, options);

        expect(report.auditLogs.deleted).toBe(1);

        // Verify old log is gone, recent remains
        const oldCount = db.query(`SELECT COUNT(*) as c FROM audit_log WHERE action = 'old_action'`).get() as { c: number };
        const recentCount = db.query(`SELECT COUNT(*) as c FROM audit_log WHERE action = 'recent_action'`).get() as { c: number };
        expect(oldCount.c).toBe(0);
        expect(recentCount.c).toBe(1);
      });
    });

    describe('counting', () => {
      it('should report correct total counts', async () => {
        // Insert aliases
        db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('a1', 'github.com/test/1')`);
        db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('a2', 'github.com/test/2')`);
        db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('a3', 'github.com/test/3')`);

        // Insert audit logs
        db.run(`INSERT INTO audit_log (agent_id, action) VALUES ('test@host', 'action1')`);
        db.run(`INSERT INTO audit_log (agent_id, action) VALUES ('test@host', 'action2')`);

        const options: MaintenanceOptions = {
          aliasMaxAgeDays: 365,
          auditMaxAgeDays: 90,
          dryRun: true,
        };

        const report = await runMaintenance(db, options);

        expect(report.aliases.total).toBe(3);
        expect(report.auditLogs.total).toBe(2);
      });

      it('should report correct agent stats', async () => {
        const now = Math.floor(Date.now() / 1000);

        // Insert agents with various states
        // Verified agent
        db.run(`
          INSERT INTO agents (id, api_key_hash, created_at_epoch, verified)
          VALUES ('verified@host', 'sha256:abc', ?, 1)
        `, [now]);

        // Unverified agent
        db.run(`
          INSERT INTO agents (id, api_key_hash, created_at_epoch, verified)
          VALUES ('unverified@host', 'sha256:def', ?, 0)
        `, [now]);

        // Locked agent
        db.run(`
          INSERT INTO agents (id, api_key_hash, created_at_epoch, verified, locked_until_epoch)
          VALUES ('locked@host', 'sha256:ghi', ?, 1, ?)
        `, [now, now + 3600]); // Locked for another hour

        // Agent with expired key
        db.run(`
          INSERT INTO agents (id, api_key_hash, created_at_epoch, verified, expires_at_epoch)
          VALUES ('expired@host', 'sha256:jkl', ?, 1, ?)
        `, [now, now - 3600]); // Expired an hour ago

        const options: MaintenanceOptions = {
          aliasMaxAgeDays: 365,
          auditMaxAgeDays: 90,
          dryRun: true,
        };

        const report = await runMaintenance(db, options);

        expect(report.agents.total).toBe(4);
        expect(report.agents.verified).toBe(3); // verified, locked, expired are all verified=1
        expect(report.agents.locked).toBe(1);
        expect(report.agents.expiredKeys).toBe(1);
      });
    });

    describe('custom thresholds', () => {
      it('should respect custom alias max age', async () => {
        const now = Math.floor(Date.now() / 1000);
        // Insert alias 45 days old
        const epoch45DaysAgo = now - (45 * 86400);
        db.run(`
          INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
          VALUES ('forty-five-days', 'github.com/test/repo', ?)
        `, [epoch45DaysAgo]);

        // Should not delete with 60-day threshold
        const report60 = await runMaintenance(db, {
          aliasMaxAgeDays: 60,
          auditMaxAgeDays: 90,
          dryRun: true,
        });
        expect(report60.aliases.olderThan).toBe(0);

        // Should delete with 30-day threshold
        const report30 = await runMaintenance(db, {
          aliasMaxAgeDays: 30,
          auditMaxAgeDays: 90,
          dryRun: true,
        });
        expect(report30.aliases.olderThan).toBe(1);
      });

      it('should respect custom audit max age', async () => {
        const now = Math.floor(Date.now() / 1000);
        // Insert audit log 45 days old
        const epoch45DaysAgo = now - (45 * 86400);
        db.run(`
          INSERT INTO audit_log (agent_id, action, created_at_epoch)
          VALUES ('test@host', 'forty_five_days', ?)
        `, [epoch45DaysAgo]);

        // Should not delete with 60-day threshold
        const report60 = await runMaintenance(db, {
          aliasMaxAgeDays: 365,
          auditMaxAgeDays: 60,
          dryRun: true,
        });
        expect(report60.auditLogs.olderThan).toBe(0);

        // Should delete with 30-day threshold
        const report30 = await runMaintenance(db, {
          aliasMaxAgeDays: 365,
          auditMaxAgeDays: 30,
          dryRun: true,
        });
        expect(report30.auditLogs.olderThan).toBe(1);
      });
    });
  });

  describe('formatMaintenanceReport', () => {
    it('should format dry run report correctly', () => {
      const report: MaintenanceReport = {
        aliases: { total: 42, olderThan: 5, deleted: 0 },
        auditLogs: { total: 1523, olderThan: 234, deleted: 0 },
        agents: { total: 15, verified: 12, locked: 1, expiredKeys: 3 },
        dryRun: true,
      };

      const output = formatMaintenanceReport(report);

      expect(output).toContain('Claude-mem Maintenance Report');
      expect(output).toContain('Aliases:');
      expect(output).toContain('Total: 42');
      expect(output).toContain('Older than threshold: 5');
      expect(output).toContain('[DRY RUN] Would delete: 5');
      expect(output).toContain('Audit Logs:');
      expect(output).toContain('Total: 1523');
      expect(output).toContain('Older than threshold: 234');
      expect(output).toContain('[DRY RUN] Would delete: 234');
      expect(output).toContain('Agents:');
      expect(output).toContain('Total: 15');
      expect(output).toContain('Verified: 12');
      expect(output).toContain('Currently locked: 1');
      expect(output).toContain('Expired keys: 3');
      expect(output).toContain('Run without --dry-run to perform cleanup.');
    });

    it('should format actual run report correctly', () => {
      const report: MaintenanceReport = {
        aliases: { total: 37, olderThan: 5, deleted: 5 },
        auditLogs: { total: 1289, olderThan: 234, deleted: 234 },
        agents: { total: 15, verified: 12, locked: 1, expiredKeys: 3 },
        dryRun: false,
      };

      const output = formatMaintenanceReport(report);

      expect(output).toContain('Deleted: 5');
      expect(output).toContain('Deleted: 234');
      expect(output).not.toContain('[DRY RUN]');
      expect(output).not.toContain('Run without --dry-run');
    });

    it('should format empty report correctly', () => {
      const report: MaintenanceReport = {
        aliases: { total: 0, olderThan: 0, deleted: 0 },
        auditLogs: { total: 0, olderThan: 0, deleted: 0 },
        agents: { total: 0, verified: 0, locked: 0, expiredKeys: 0 },
        dryRun: true,
      };

      const output = formatMaintenanceReport(report);

      expect(output).toContain('Total: 0');
      expect(output).toContain('Older than threshold: 0');
    });
  });
});
