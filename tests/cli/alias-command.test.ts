/**
 * Alias CLI Commands Tests (Task 1.7)
 *
 * Tests the CLI command functions for managing project aliases:
 * - list: Show all aliases or filter by project
 * - add: Register new alias
 * - cleanup: Remove old aliases
 * - count: Count aliases for a project
 *
 * Sources:
 * - Task spec: docs/plans/agents/task-1.7-migration-cli.md
 * - Project aliases: src/services/sqlite/project-aliases.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import {
  listAliases,
  addAlias,
  cleanupAliases,
  countAliases,
  formatAliasList,
} from '../../src/cli/commands/alias.js';
import { MAX_ALIASES_IN_QUERY } from '../../src/services/sqlite/project-aliases.js';
import type { Database } from 'bun:sqlite';

describe('Alias CLI Commands', () => {
  let db: Database;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;

    // Seed test data
    db.run(`
      INSERT INTO project_aliases (old_project, new_project)
      VALUES
        ('proj-a', 'github.com/user/repo'),
        ('proj-b', 'github.com/user/repo'),
        ('other', 'github.com/other/repo')
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe('listAliases', () => {
    it('should list all aliases', () => {
      const result = listAliases(db);

      expect(result.aliases).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it('should filter by project', () => {
      const result = listAliases(db, 'github.com/user/repo');

      expect(result.aliases).toHaveLength(2);
      expect(result.aliases.every(a => a.new_project === 'github.com/user/repo')).toBe(true);
    });

    it('should return empty array for non-existent project', () => {
      const result = listAliases(db, 'github.com/nonexistent/repo');

      expect(result.aliases).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should sort by created_at descending', () => {
      // Insert with explicit timestamps
      const now = Math.floor(Date.now() / 1000);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
        VALUES ('newest', 'github.com/test/repo', ?)
      `, [now + 1000]);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
        VALUES ('oldest', 'github.com/test/repo', ?)
      `, [now - 1000]);

      const result = listAliases(db);

      // Newest should be first
      const newestIndex = result.aliases.findIndex(a => a.old_project === 'newest');
      const oldestIndex = result.aliases.findIndex(a => a.old_project === 'oldest');
      expect(newestIndex).toBeLessThan(oldestIndex);
    });
  });

  describe('addAlias', () => {
    it('should create new alias', () => {
      const result = addAlias(db, 'new-name', 'github.com/user/new-repo');

      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(result.message).toContain('created');
    });

    it('should report duplicate', () => {
      const result = addAlias(db, 'proj-a', 'github.com/user/repo');

      expect(result.success).toBe(true);
      expect(result.created).toBe(false);
      expect(result.message).toContain('already exists');
    });

    it('should validate empty old project', () => {
      const result = addAlias(db, '', 'github.com/user/repo');

      expect(result.success).toBe(false);
      expect(result.created).toBe(false);
      expect(result.message).toContain('required');
    });

    it('should validate empty new project', () => {
      const result = addAlias(db, 'old-name', '');

      expect(result.success).toBe(false);
      expect(result.created).toBe(false);
      expect(result.message).toContain('required');
    });

    it('should reject same old and new project', () => {
      const result = addAlias(db, 'same-name', 'same-name');

      expect(result.success).toBe(false);
      expect(result.created).toBe(false);
      expect(result.message).toContain('different');
    });
  });

  describe('cleanupAliases', () => {
    it('should delete old aliases', () => {
      // Insert old alias
      const oldEpoch = Math.floor(Date.now() / 1000) - (400 * 86400);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
        VALUES ('ancient', 'github.com/old/repo', ?)
      `, [oldEpoch]);

      const result = cleanupAliases(db, { days: 365, dryRun: false });

      expect(result.deleted).toBe(1);
      expect(result.dryRun).toBe(false);

      // Verify it's gone
      const count = db.query(`SELECT COUNT(*) as c FROM project_aliases WHERE old_project = 'ancient'`).get() as { c: number };
      expect(count.c).toBe(0);
    });

    it('should not delete on dry run', () => {
      const oldEpoch = Math.floor(Date.now() / 1000) - (400 * 86400);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
        VALUES ('ancient', 'github.com/old/repo', ?)
      `, [oldEpoch]);

      const result = cleanupAliases(db, { days: 365, dryRun: true });

      expect(result.wouldDelete).toBe(1);
      expect(result.deleted).toBe(0);
      expect(result.dryRun).toBe(true);

      // Verify still exists
      const count = db.query(`SELECT COUNT(*) as c FROM project_aliases WHERE old_project = 'ancient'`).get() as { c: number };
      expect(count.c).toBe(1);
    });

    it('should not delete aliases within threshold', () => {
      // All seeded aliases are recent (created just now)
      const initialCount = db.query(`SELECT COUNT(*) as c FROM project_aliases`).get() as { c: number };

      const result = cleanupAliases(db, { days: 365, dryRun: false });

      expect(result.deleted).toBe(0);

      // Verify count unchanged
      const afterCount = db.query(`SELECT COUNT(*) as c FROM project_aliases`).get() as { c: number };
      expect(afterCount.c).toBe(initialCount.c);
    });

    it('should respect custom days threshold', () => {
      const epoch30DaysAgo = Math.floor(Date.now() / 1000) - (30 * 86400);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
        VALUES ('thirty-days', 'github.com/old/repo', ?)
      `, [epoch30DaysAgo]);

      // Should not delete with 60-day threshold
      const result60 = cleanupAliases(db, { days: 60, dryRun: true });
      expect(result60.wouldDelete).toBe(0);

      // Should delete with 7-day threshold
      const result7 = cleanupAliases(db, { days: 7, dryRun: true });
      expect(result7.wouldDelete).toBe(1);
    });
  });

  describe('countAliases', () => {
    it('should show correct count', () => {
      const result = countAliases(db, 'github.com/user/repo');

      expect(result.count).toBe(2);
      expect(result.project).toBe('github.com/user/repo');
      expect(result.exceedsLimit).toBe(false);
      expect(result.limit).toBe(MAX_ALIASES_IN_QUERY);
    });

    it('should return zero for non-existent project', () => {
      const result = countAliases(db, 'github.com/nonexistent/repo');

      expect(result.count).toBe(0);
      expect(result.exceedsLimit).toBe(false);
    });

    it('should warn when count exceeds limit', () => {
      // Insert many aliases to exceed limit
      for (let i = 0; i < MAX_ALIASES_IN_QUERY + 5; i++) {
        db.run(`
          INSERT INTO project_aliases (old_project, new_project)
          VALUES ('alias-${i}', 'github.com/many/aliases')
        `.replace('${i}', String(i)));
      }

      const result = countAliases(db, 'github.com/many/aliases');

      expect(result.count).toBe(MAX_ALIASES_IN_QUERY + 5);
      expect(result.exceedsLimit).toBe(true);
    });
  });

  describe('formatAliasList', () => {
    it('should format empty list', () => {
      const result = formatAliasList({ aliases: [], total: 0 });

      expect(result).toContain('No aliases found');
    });

    it('should format non-empty list', () => {
      const aliases = [
        { id: 1, old_project: 'proj-a', new_project: 'github.com/user/repo', created_at: '2026-02-03' },
      ];
      const result = formatAliasList({ aliases, total: 1 });

      expect(result).toContain('1 alias');
      expect(result).toContain('proj-a');
      expect(result).toContain('github.com/user/repo');
    });
  });
});
