/**
 * Project Alias Resolution Service Tests
 * Tests for managing project aliases: registering new mappings,
 * resolving aliases for queries, and cleaning up old entries.
 *
 * Sources:
 * - Task spec: docs/plans/agents/specs/task-1.4.spec.md
 * - Migration tests: tests/sqlite/project-aliases-migration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import {
  registerProjectAlias,
  getProjectsWithAliases,
  getAliasCount,
  cleanupOldAliases,
  MAX_ALIASES_IN_QUERY
} from '../../src/services/sqlite/project-aliases.js';
import type { Database } from 'bun:sqlite';

describe('Project Alias Resolution Service', () => {
  let db: Database;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
  });

  afterEach(() => {
    db.close();
  });

  describe('registerProjectAlias', () => {
    it('should create new alias and return true', () => {
      const result = registerProjectAlias(db, 'old-name', 'github.com/user/repo');
      expect(result).toBe(true);

      const count = getAliasCount(db, 'github.com/user/repo');
      expect(count).toBe(1);
    });

    it('should ignore duplicate and return false', () => {
      registerProjectAlias(db, 'old-name', 'github.com/user/repo');
      const result = registerProjectAlias(db, 'old-name', 'github.com/user/repo');

      expect(result).toBe(false);
      expect(getAliasCount(db, 'github.com/user/repo')).toBe(1);
    });

    it('should return false when oldProject equals newProject', () => {
      const result = registerProjectAlias(db, 'same-name', 'same-name');

      expect(result).toBe(false);
      expect(getAliasCount(db, 'same-name')).toBe(0);
    });

    it('should allow multiple aliases for the same new_project', () => {
      registerProjectAlias(db, 'alias-1', 'github.com/user/repo');
      registerProjectAlias(db, 'alias-2', 'github.com/user/repo');
      registerProjectAlias(db, 'alias-3', 'github.com/user/repo');

      expect(getAliasCount(db, 'github.com/user/repo')).toBe(3);
    });
  });

  describe('getProjectsWithAliases', () => {
    it('should return project + aliases', () => {
      registerProjectAlias(db, 'alias-1', 'github.com/user/repo');
      registerProjectAlias(db, 'alias-2', 'github.com/user/repo');

      const projects = getProjectsWithAliases(db, 'github.com/user/repo');

      expect(projects).toContain('github.com/user/repo');
      expect(projects).toContain('alias-1');
      expect(projects).toContain('alias-2');
      expect(projects).toHaveLength(3);
    });

    it('should return only project when no aliases', () => {
      const projects = getProjectsWithAliases(db, 'github.com/user/new-repo');

      expect(projects).toEqual(['github.com/user/new-repo']);
    });

    it('should always include the input project first', () => {
      registerProjectAlias(db, 'alias-1', 'github.com/user/repo');

      const projects = getProjectsWithAliases(db, 'github.com/user/repo');

      expect(projects[0]).toBe('github.com/user/repo');
    });

    it('should respect MAX_ALIASES_IN_QUERY limit', () => {
      // Insert more than MAX_ALIASES_IN_QUERY aliases
      for (let i = 0; i < MAX_ALIASES_IN_QUERY + 10; i++) {
        db.run(`
          INSERT INTO project_aliases (old_project, new_project)
          VALUES (?, 'github.com/user/repo')
        `, [`alias-${i}`]);
      }

      const projects = getProjectsWithAliases(db, 'github.com/user/repo');

      // Should have project + MAX_ALIASES_IN_QUERY aliases
      expect(projects.length).toBeLessThanOrEqual(MAX_ALIASES_IN_QUERY + 1);
    });
  });

  describe('getAliasCount', () => {
    it('should return correct count', () => {
      registerProjectAlias(db, 'a', 'github.com/user/repo');
      registerProjectAlias(db, 'b', 'github.com/user/repo');
      registerProjectAlias(db, 'c', 'github.com/user/repo');

      expect(getAliasCount(db, 'github.com/user/repo')).toBe(3);
    });

    it('should return 0 for project without aliases', () => {
      expect(getAliasCount(db, 'github.com/user/new')).toBe(0);
    });

    it('should count only aliases for specified project', () => {
      registerProjectAlias(db, 'alias-a', 'github.com/user/repo-a');
      registerProjectAlias(db, 'alias-b', 'github.com/user/repo-b');
      registerProjectAlias(db, 'alias-c', 'github.com/user/repo-a');

      expect(getAliasCount(db, 'github.com/user/repo-a')).toBe(2);
      expect(getAliasCount(db, 'github.com/user/repo-b')).toBe(1);
    });
  });

  describe('cleanupOldAliases', () => {
    it('should delete old aliases', () => {
      // Insert alias with old timestamp (400 days ago)
      const oldEpoch = Math.floor(Date.now() / 1000) - (400 * 86400);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
        VALUES ('old-alias', 'github.com/user/repo', ?)
      `, [oldEpoch]);

      // Insert recent alias
      registerProjectAlias(db, 'new-alias', 'github.com/user/repo');

      const deleted = cleanupOldAliases(db, 365);

      expect(deleted).toBe(1);
      expect(getAliasCount(db, 'github.com/user/repo')).toBe(1);
    });

    it('should keep recent aliases', () => {
      registerProjectAlias(db, 'recent', 'github.com/user/repo');

      const deleted = cleanupOldAliases(db, 365);

      expect(deleted).toBe(0);
      expect(getAliasCount(db, 'github.com/user/repo')).toBe(1);
    });

    it('should use default 365 days when olderThanDays not specified', () => {
      // Insert alias that's 400 days old
      const oldEpoch = Math.floor(Date.now() / 1000) - (400 * 86400);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
        VALUES ('old-alias', 'github.com/user/repo', ?)
      `, [oldEpoch]);

      // Insert alias that's 300 days old (should be kept with default 365)
      const recentOldEpoch = Math.floor(Date.now() / 1000) - (300 * 86400);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
        VALUES ('recent-old-alias', 'github.com/user/repo', ?)
      `, [recentOldEpoch]);

      const deleted = cleanupOldAliases(db);

      expect(deleted).toBe(1);
      expect(getAliasCount(db, 'github.com/user/repo')).toBe(1);
    });

    it('should delete multiple old aliases', () => {
      // Insert 3 old aliases
      const oldEpoch = Math.floor(Date.now() / 1000) - (400 * 86400);
      for (let i = 0; i < 3; i++) {
        db.run(`
          INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
          VALUES (?, 'github.com/user/repo', ?)
        `, [`old-alias-${i}`, oldEpoch]);
      }

      // Insert 2 recent aliases
      registerProjectAlias(db, 'new-1', 'github.com/user/repo');
      registerProjectAlias(db, 'new-2', 'github.com/user/repo');

      const deleted = cleanupOldAliases(db, 365);

      expect(deleted).toBe(3);
      expect(getAliasCount(db, 'github.com/user/repo')).toBe(2);
    });
  });
});
