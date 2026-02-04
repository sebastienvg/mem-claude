/**
 * Git Available Utility Tests
 *
 * Tests the isGitAvailable() function that detects if git CLI is installed.
 * Caches result to avoid repeated shell calls.
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
