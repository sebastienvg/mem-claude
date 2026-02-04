/**
 * Git Remote Utilities Tests
 *
 * Tests the git remote URL normalization and detection utilities.
 * These utilities enable project identification via git remotes.
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

    it('should normalize GitHub enterprise URL with port', () => {
      const result = normalizeGitUrl('https://github.example.com:8443/org/repo.git');
      expect(result).toBe('github.example.com/org/repo');
    });

    it('should return null for invalid URL', () => {
      expect(normalizeGitUrl('not-a-url')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(normalizeGitUrl('')).toBeNull();
    });

    it('should return null for null input', () => {
      expect(normalizeGitUrl(null as any)).toBeNull();
    });

    it('should return null for undefined input', () => {
      expect(normalizeGitUrl(undefined as any)).toBeNull();
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

    it('should handle empty output', () => {
      const remotes = parseGitRemotes('');
      expect(remotes).toHaveLength(0);
    });

    it('should handle single remote', () => {
      const output = `origin\tgit@github.com:user/repo.git (fetch)
origin\tgit@github.com:user/repo.git (push)`;

      const remotes = parseGitRemotes(output);
      expect(remotes).toHaveLength(1);
      expect(remotes[0].name).toBe('origin');
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

    it('should return normalized remote for current repo', () => {
      // This is an integration test - the current repo has git configured
      const result = getGitRemoteIdentifier(process.cwd());
      // The current repo should have a GitHub remote
      expect(result).toMatch(/^github\.com\/[\w.-]+\/[\w.-]+$/);
    });
  });
});
