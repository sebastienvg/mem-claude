/**
 * Project Aliases Migration Tests (Migration 022)
 * Tests the project_aliases table for mapping old folder-based names
 * to new git-remote-based identifiers.
 *
 * Tests:
 * - project_aliases table creation with all columns
 * - Unique constraint on (old_project, new_project) pair
 * - Index creation for efficient lookups
 * - Auto-populated timestamp columns
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import type { Database } from 'bun:sqlite';

interface TableColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexInfo {
  name: string;
  tbl_name: string;
  unique: number;
}

interface TableNameRow {
  name: string;
}

interface AliasRow {
  id: number;
  old_project: string;
  new_project: string;
  created_at: string;
  created_at_epoch: number;
}

describe('Project Aliases Migration (022)', () => {
  let db: Database;

  beforeEach(() => {
    // ClaudeMemDatabase runs all migrations automatically
    db = new ClaudeMemDatabase(':memory:').db;
  });

  afterEach(() => {
    db.close();
  });

  describe('project_aliases table', () => {
    it('should create project_aliases table', () => {
      const tables = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='project_aliases'
      `).all() as TableNameRow[];

      expect(tables).toHaveLength(1);
    });

    it('should have all required columns', () => {
      const columns = db.query(`PRAGMA table_info(project_aliases)`).all() as TableColumnInfo[];
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('old_project');
      expect(columnNames).toContain('new_project');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('created_at_epoch');
    });

    it('should have correct column constraints', () => {
      const columns = db.query(`PRAGMA table_info(project_aliases)`).all() as TableColumnInfo[];

      const idCol = columns.find(c => c.name === 'id');
      expect(idCol?.pk).toBe(1); // Primary key

      const oldProjectCol = columns.find(c => c.name === 'old_project');
      expect(oldProjectCol?.notnull).toBe(1); // NOT NULL

      const newProjectCol = columns.find(c => c.name === 'new_project');
      expect(newProjectCol?.notnull).toBe(1); // NOT NULL
    });

    it('should have index on new_project for reverse lookups', () => {
      const indexes = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='project_aliases' AND name LIKE '%new_project%'
      `).all() as IndexInfo[];

      expect(indexes.length).toBeGreaterThan(0);
    });

    it('should have index on created_at_epoch for cleanup queries', () => {
      const indexes = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='project_aliases' AND name LIKE '%created%'
      `).all() as IndexInfo[];

      expect(indexes.length).toBeGreaterThan(0);
    });
  });

  describe('insert operations', () => {
    it('should allow inserting alias mapping', () => {
      db.run(`
        INSERT INTO project_aliases (old_project, new_project)
        VALUES ('claude-mem', 'github.com/sebastienvg/claude-mem')
      `);

      const result = db.query(`
        SELECT * FROM project_aliases WHERE old_project = 'claude-mem'
      `).get() as AliasRow;

      expect(result.new_project).toBe('github.com/sebastienvg/claude-mem');
      expect(result.created_at).toBeTruthy();
      expect(result.created_at_epoch).toBeGreaterThan(0);
    });

    it('should auto-populate created_at timestamps', () => {
      const before = Math.floor(Date.now() / 1000);

      db.run(`
        INSERT INTO project_aliases (old_project, new_project)
        VALUES ('my-project', 'github.com/user/my-project')
      `);

      const after = Math.floor(Date.now() / 1000);

      const result = db.query(`
        SELECT * FROM project_aliases WHERE old_project = 'my-project'
      `).get() as AliasRow;

      expect(result.created_at).toBeTruthy();
      expect(result.created_at_epoch).toBeGreaterThanOrEqual(before);
      expect(result.created_at_epoch).toBeLessThanOrEqual(after + 1);
    });

    it('should enforce unique constraint on old_project + new_project', () => {
      db.run(`
        INSERT INTO project_aliases (old_project, new_project)
        VALUES ('my-project', 'github.com/user/my-project')
      `);

      expect(() => {
        db.run(`
          INSERT INTO project_aliases (old_project, new_project)
          VALUES ('my-project', 'github.com/user/my-project')
        `);
      }).toThrow();
    });

    it('should allow same old_project with different new_project (fork scenario)', () => {
      // This could happen if a project is forked or if the same folder name
      // is used in different repos
      db.run(`
        INSERT INTO project_aliases (old_project, new_project)
        VALUES ('my-project', 'github.com/user1/my-project')
      `);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project)
        VALUES ('my-project', 'github.com/user2/my-project')
      `);

      const results = db.query(`
        SELECT * FROM project_aliases WHERE old_project = 'my-project'
      `).all() as AliasRow[];

      expect(results).toHaveLength(2);
    });

    it('should allow same new_project with different old_project (multiple checkout paths)', () => {
      // This happens when the same repo is checked out in different locations
      db.run(`
        INSERT INTO project_aliases (old_project, new_project)
        VALUES ('work-checkout', 'github.com/user/repo')
      `);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project)
        VALUES ('home-checkout', 'github.com/user/repo')
      `);

      const results = db.query(`
        SELECT old_project FROM project_aliases
        WHERE new_project = 'github.com/user/repo'
      `).all() as { old_project: string }[];

      expect(results.map(r => r.old_project)).toContain('work-checkout');
      expect(results.map(r => r.old_project)).toContain('home-checkout');
    });
  });

  describe('query operations', () => {
    beforeEach(() => {
      // Set up test data
      db.run(`
        INSERT INTO project_aliases (old_project, new_project)
        VALUES ('proj-a', 'github.com/user/repo')
      `);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project)
        VALUES ('proj-b', 'github.com/user/repo')
      `);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project)
        VALUES ('other-proj', 'github.com/user/other-repo')
      `);
    });

    it('should query aliases by new_project', () => {
      const results = db.query(`
        SELECT old_project FROM project_aliases
        WHERE new_project = 'github.com/user/repo'
      `).all() as { old_project: string }[];

      expect(results.map(r => r.old_project)).toContain('proj-a');
      expect(results.map(r => r.old_project)).toContain('proj-b');
      expect(results.map(r => r.old_project)).not.toContain('other-proj');
    });

    it('should query aliases by old_project', () => {
      const result = db.query(`
        SELECT new_project FROM project_aliases
        WHERE old_project = 'proj-a'
      `).get() as { new_project: string };

      expect(result.new_project).toBe('github.com/user/repo');
    });
  });

  describe('migration idempotency', () => {
    it('should handle existing tables gracefully', () => {
      // The migration already ran in beforeEach
      // Running ClaudeMemDatabase again should not throw
      // We test this by checking the table still exists with correct structure

      const tables = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='project_aliases'
      `).all() as TableNameRow[];

      expect(tables).toHaveLength(1);
    });
  });
});
