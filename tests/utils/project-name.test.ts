/**
 * Project Name Utility Tests
 *
 * Tests for project identification from working directory,
 * including git remote detection and fallback to basename.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { getProjectName, getProjectContext } from '../../src/utils/project-name.js';
import * as gitRemote from '../../src/utils/git-remote.js';
import { logger } from '../../src/utils/logger.js';

// Suppress logger output during tests
let loggerSpies: ReturnType<typeof spyOn>[] = [];

describe('Project Name Utilities', () => {
  beforeEach(() => {
    loggerSpies = [
      spyOn(logger, 'info').mockImplementation(() => {}),
      spyOn(logger, 'debug').mockImplementation(() => {}),
      spyOn(logger, 'warn').mockImplementation(() => {}),
      spyOn(logger, 'error').mockImplementation(() => {}),
    ];
  });

  afterEach(() => {
    loggerSpies.forEach(spy => spy.mockRestore());
  });

  describe('getProjectName', () => {
    describe('git remote priority', () => {
      it('should return git remote identifier when available', () => {
        const spy = spyOn(gitRemote, 'getGitRemoteIdentifier')
          .mockReturnValue('github.com/user/repo');

        const result = getProjectName('/some/path/repo');
        expect(result).toBe('github.com/user/repo');

        spy.mockRestore();
      });

      it('should fall back to basename when no git remote', () => {
        const spy = spyOn(gitRemote, 'getGitRemoteIdentifier')
          .mockReturnValue(null);

        const result = getProjectName('/some/path/my-project');
        expect(result).toBe('my-project');

        spy.mockRestore();
      });
    });

    describe('fallback handling', () => {
      it('should return unknown-project for empty cwd', () => {
        expect(getProjectName('')).toBe('unknown-project');
      });

      it('should return unknown-project for null cwd', () => {
        expect(getProjectName(null)).toBe('unknown-project');
      });

      it('should return unknown-project for undefined cwd', () => {
        expect(getProjectName(undefined)).toBe('unknown-project');
      });

      it('should return unknown-project for whitespace-only cwd', () => {
        expect(getProjectName('   ')).toBe('unknown-project');
      });
    });

    describe('edge cases', () => {
      it('should handle trailing slashes', () => {
        const spy = spyOn(gitRemote, 'getGitRemoteIdentifier')
          .mockReturnValue(null);

        const result = getProjectName('/some/path/my-project/');
        expect(result).toBe('my-project');

        spy.mockRestore();
      });

      it('should handle paths with special characters', () => {
        const spy = spyOn(gitRemote, 'getGitRemoteIdentifier')
          .mockReturnValue(null);

        const result = getProjectName('/some/path/my-awesome_project.v2');
        expect(result).toBe('my-awesome_project.v2');

        spy.mockRestore();
      });
    });

    describe('integration tests', () => {
      it('should return valid identifier for current repo', () => {
        const result = getProjectName(process.cwd());
        // Should be either a git remote or the folder name
        expect(result).toBeTruthy();
        expect(result).not.toBe('unknown-project');
      });

      it('should return consistent results for same path', () => {
        const cwd = process.cwd();
        const result1 = getProjectName(cwd);
        const result2 = getProjectName(cwd);
        expect(result1).toBe(result2);
      });
    });
  });

  describe('getProjectContext', () => {
    it('should return primary project name', () => {
      const spy = spyOn(gitRemote, 'getGitRemoteIdentifier')
        .mockReturnValue('github.com/user/repo');

      const context = getProjectContext('/some/path/repo');
      expect(context.primary).toBe('github.com/user/repo');
      expect(context.allProjects).toContain('github.com/user/repo');

      spy.mockRestore();
    });

    it('should handle null cwd', () => {
      const context = getProjectContext(null);
      expect(context.primary).toBe('unknown-project');
      expect(context.isWorktree).toBe(false);
      expect(context.parent).toBeNull();
      expect(context.allProjects).toEqual(['unknown-project']);
    });

    it('should handle undefined cwd', () => {
      const context = getProjectContext(undefined);
      expect(context.primary).toBe('unknown-project');
      expect(context.isWorktree).toBe(false);
    });
  });
});
