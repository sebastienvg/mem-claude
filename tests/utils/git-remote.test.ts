/**
 * Git Remote Utilities Tests
 *
 * Tests for git remote URL normalization and detection.
 */

import { describe, it, expect } from 'bun:test';
import {
  getGitRemoteIdentifier,
  normalizeGitUrl,
  getPreferredRemote,
  parseGitRemotes
} from '../../src/utils/git-remote.js';

describe('Git Remote Utilities', () => {
  describe('normalizeGitUrl', () => {
    it('should normalize HTTPS GitHub URL', () => {
      const result = normalizeGitUrl('https://github.com/sebastienvg/mem-claude.git');
      expect(result).toBe('github.com/sebastienvg/mem-claude');
    });

    it('should normalize HTTPS GitHub URL without .git', () => {
      const result = normalizeGitUrl('https://github.com/user/repo');
      expect(result).toBe('github.com/user/repo');
    });

    it('should normalize SSH GitHub URL', () => {
      const result = normalizeGitUrl('git@github.com:sebastienvg/mem-claude.git');
      expect(result).toBe('github.com/sebastienvg/mem-claude');
    });

    it('should normalize SSH URL without .git suffix', () => {
      const result = normalizeGitUrl('git@github.com:user/repo');
      expect(result).toBe('github.com/user/repo');
    });

    it('should normalize GitHub enterprise URL with port', () => {
      const result = normalizeGitUrl('https://github.example.com:8443/org/repo.git');
      expect(result).toBe('github.example.com/org/repo');
    });

    it('should normalize GitLab URLs', () => {
      const result = normalizeGitUrl('https://gitlab.com/group/project.git');
      expect(result).toBe('gitlab.com/group/project');
    });

    it('should normalize Bitbucket URLs', () => {
      const result = normalizeGitUrl('git@bitbucket.org:user/repo.git');
      expect(result).toBe('bitbucket.org/user/repo');
    });

    it('should handle nested paths', () => {
      const result = normalizeGitUrl('https://github.com/org/team/project.git');
      expect(result).toBe('github.com/org/team/project');
    });

    it('should return null for invalid URL', () => {
      expect(normalizeGitUrl('not-a-url')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(normalizeGitUrl('')).toBeNull();
    });

    it('should return null for null input', () => {
      expect(normalizeGitUrl(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(normalizeGitUrl(undefined)).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      expect(normalizeGitUrl('   ')).toBeNull();
    });
  });

  describe('parseGitRemotes', () => {
    it('should parse git remote -v output', () => {
      const output = `origin\thttps://github.com/user/repo.git (fetch)
origin\thttps://github.com/user/repo.git (push)
upstream\thttps://github.com/other/repo.git (fetch)
upstream\thttps://github.com/other/repo.git (push)`;

      const remotes = parseGitRemotes(output);
      expect(remotes).toHaveLength(2);
      expect(remotes[0].name).toBe('origin');
      expect(remotes[0].url).toBe('https://github.com/user/repo.git');
      expect(remotes[1].name).toBe('upstream');
      expect(remotes[1].url).toBe('https://github.com/other/repo.git');
    });

    it('should only include fetch URLs', () => {
      const output = `origin\thttps://github.com/user/repo.git (fetch)
origin\thttps://different.com/push/url.git (push)`;

      const remotes = parseGitRemotes(output);
      expect(remotes).toHaveLength(1);
      expect(remotes[0].url).toBe('https://github.com/user/repo.git');
    });

    it('should deduplicate by name', () => {
      // Unlikely edge case but good to test
      const output = `origin\thttps://github.com/user/repo.git (fetch)
origin\thttps://github.com/user/repo.git (fetch)`;

      const remotes = parseGitRemotes(output);
      expect(remotes).toHaveLength(1);
    });

    it('should handle empty output', () => {
      const remotes = parseGitRemotes('');
      expect(remotes).toHaveLength(0);
    });

    it('should handle SSH remotes', () => {
      const output = `origin\tgit@github.com:user/repo.git (fetch)
origin\tgit@github.com:user/repo.git (push)`;

      const remotes = parseGitRemotes(output);
      expect(remotes).toHaveLength(1);
      expect(remotes[0].url).toBe('git@github.com:user/repo.git');
    });
  });

  describe('getPreferredRemote', () => {
    it('should prefer origin remote by default', () => {
      const remotes = [
        { name: 'upstream', url: 'https://github.com/other/repo.git' },
        { name: 'origin', url: 'https://github.com/user/repo.git' },
      ];
      const result = getPreferredRemote(remotes);
      expect(result?.name).toBe('origin');
    });

    it('should prefer upstream over other remotes when origin not present', () => {
      const remotes = [
        { name: 'custom', url: 'https://github.com/custom/repo.git' },
        { name: 'upstream', url: 'https://github.com/upstream/repo.git' },
      ];
      const result = getPreferredRemote(remotes);
      expect(result?.name).toBe('upstream');
    });

    it('should respect custom preference order', () => {
      const remotes = [
        { name: 'origin', url: 'https://github.com/fork/repo.git' },
        { name: 'upstream', url: 'https://github.com/original/repo.git' },
      ];
      const result = getPreferredRemote(remotes, ['upstream', 'origin']);
      expect(result?.name).toBe('upstream');
    });

    it('should fall back to first remote if no preferred found', () => {
      const remotes = [
        { name: 'custom', url: 'https://github.com/other/repo.git' },
      ];
      const result = getPreferredRemote(remotes, ['origin', 'upstream']);
      expect(result?.name).toBe('custom');
    });

    it('should return null for empty remotes array', () => {
      const result = getPreferredRemote([]);
      expect(result).toBeNull();
    });
  });

  describe('getGitRemoteIdentifier', () => {
    it('should return null for non-git directory', () => {
      const result = getGitRemoteIdentifier('/tmp');
      expect(result).toBeNull();
    });

    it('should return null for non-existent directory', () => {
      const result = getGitRemoteIdentifier('/nonexistent/path/12345');
      expect(result).toBeNull();
    });

    it('should return normalized remote for current repo (integration)', () => {
      const result = getGitRemoteIdentifier(process.cwd());
      // Should match github.com/user/repo pattern
      expect(result).toBeTruthy();
      expect(result).toMatch(/^[\w.-]+\/[\w.-]+\/[\w.-]+$/);
    });
  });
});
