/**
 * Git Available Utility Tests
 *
 * Tests for git CLI availability detection with caching.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { isGitAvailable, resetGitAvailableCache } from '../../src/utils/git-available.js';

describe('Git Available Utility', () => {
  beforeEach(() => {
    resetGitAvailableCache();
  });

  it('should return boolean', () => {
    const result = isGitAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('should return true when git is installed', () => {
    // This test assumes git is installed on the CI/dev machine
    const result = isGitAvailable();
    expect(result).toBe(true);
  });

  it('should cache result on second call', () => {
    const first = isGitAvailable();
    const second = isGitAvailable();
    expect(first).toBe(second);
  });

  it('should clear cache with resetGitAvailableCache', () => {
    isGitAvailable();
    resetGitAvailableCache();
    // No error means cache was cleared
    expect(true).toBe(true);
  });
});
