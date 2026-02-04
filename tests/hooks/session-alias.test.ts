/**
 * Session Alias Registration Tests
 *
 * Tests for automatic project alias registration during session initialization.
 * Verifies that when a project uses git remote identification, the folder
 * basename is registered as an alias for backwards compatibility.
 *
 * @see docs/plans/agents/specs/task-1.5.spec.md
 * @see src/hooks/session-alias.ts
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { registerSessionAlias } from '../../src/hooks/session-alias.js';
import {
  registerProjectAlias,
  getProjectsWithAliases,
  getAliasCount
} from '../../src/services/sqlite/project-aliases.js';
import type { Database } from 'bun:sqlite';

describe('Session Alias Registration', () => {
  let db: Database;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
  });

  afterEach(() => {
    db.close();
  });

  describe('registerSessionAlias', () => {
    it('should register alias when project has git remote (contains /)', () => {
      const cwd = '/Users/user/projects/my-repo';
      const gitRemoteId = 'github.com/user/my-repo';

      registerSessionAlias(db, cwd, gitRemoteId);

      // Verify alias was registered
      const aliases = getProjectsWithAliases(db, gitRemoteId);
      expect(aliases).toContain('my-repo');
      expect(aliases).toContain(gitRemoteId);
      expect(aliases).toHaveLength(2);
    });

    it('should not register alias when basename equals project name', () => {
      const cwd = '/Users/user/projects/my-local-project';
      const projectNameValue = 'my-local-project'; // No git remote, basename == project

      registerSessionAlias(db, cwd, projectNameValue);

      // Should not create any alias since basename == projectName
      const count = getAliasCount(db, projectNameValue);
      expect(count).toBe(0);
    });

    it('should not register alias for project without slash (not a git remote)', () => {
      const cwd = '/Users/user/projects/my-project';
      const projectNameValue = 'my-project-renamed'; // Different but no slash

      registerSessionAlias(db, cwd, projectNameValue);

      // Should not create alias since projectId doesn't contain '/'
      const count = getAliasCount(db, projectNameValue);
      expect(count).toBe(0);
    });

    it('should handle missing cwd gracefully', () => {
      expect(() => registerSessionAlias(db, '', 'github.com/user/repo')).not.toThrow();
      expect(() => registerSessionAlias(db, null, 'github.com/user/repo')).not.toThrow();
      expect(() => registerSessionAlias(db, undefined, 'github.com/user/repo')).not.toThrow();

      // No aliases should be registered
      const count = getAliasCount(db, 'github.com/user/repo');
      expect(count).toBe(0);
    });

    it('should handle missing projectId gracefully', () => {
      expect(() => registerSessionAlias(db, '/Users/user/projects/repo', '')).not.toThrow();
      expect(() => registerSessionAlias(db, '/Users/user/projects/repo', null)).not.toThrow();
      expect(() => registerSessionAlias(db, '/Users/user/projects/repo', undefined)).not.toThrow();
    });

    it('should not throw on registration failure', () => {
      const cwd = '/Users/user/projects/my-repo';
      const gitRemoteId = 'github.com/user/my-repo';

      // Close the database to simulate a failure
      db.close();

      // Should not throw even when DB operation fails
      expect(() => registerSessionAlias(db, cwd, gitRemoteId)).not.toThrow();
    });

    it('should be idempotent - registering same alias twice is a no-op', () => {
      const cwd = '/Users/user/projects/my-repo';
      const gitRemoteId = 'github.com/user/my-repo';

      // Register twice
      registerSessionAlias(db, cwd, gitRemoteId);
      registerSessionAlias(db, cwd, gitRemoteId);

      // Should still only have one alias
      const count = getAliasCount(db, gitRemoteId);
      expect(count).toBe(1);
    });

    it('should handle different basenames for same git remote', () => {
      const gitRemoteId = 'github.com/user/my-repo';

      // Simulate cloning to different folder names
      registerSessionAlias(db, '/Users/user/work/my-repo', gitRemoteId);
      registerSessionAlias(db, '/Users/user/personal/repo-clone', gitRemoteId);
      registerSessionAlias(db, '/Users/user/tmp/test-folder', gitRemoteId);

      // All basenames should be registered as aliases
      const aliases = getProjectsWithAliases(db, gitRemoteId);
      expect(aliases).toContain('my-repo');
      expect(aliases).toContain('repo-clone');
      expect(aliases).toContain('test-folder');
      expect(aliases).toContain(gitRemoteId);
      expect(aliases).toHaveLength(4);
    });

    it('should handle paths with special characters', () => {
      const cwd = '/Users/user/My Projects/my-repo';
      const gitRemoteId = 'github.com/user/my-repo';

      registerSessionAlias(db, cwd, gitRemoteId);

      const aliases = getProjectsWithAliases(db, gitRemoteId);
      expect(aliases).toContain('my-repo');
    });

    // Note: Windows-style paths are handled correctly on Windows.
    // On Unix, path.basename treats backslashes as part of the filename.
    // This test verifies the function doesn't throw on any path format.
    it('should handle Windows-style paths without throwing', () => {
      const cwd = 'C:\\Users\\user\\projects\\my-repo';
      const gitRemoteId = 'github.com/user/my-repo';

      // Should not throw regardless of platform
      expect(() => registerSessionAlias(db, cwd, gitRemoteId)).not.toThrow();

      // On Windows, this would register 'my-repo' as alias
      // On Unix, this would register the full path as alias (since backslash is valid in filenames)
      // Either way, the function should work without error
      const aliases = getProjectsWithAliases(db, gitRemoteId);
      expect(aliases.length).toBeGreaterThanOrEqual(1);
    });
  });
});
