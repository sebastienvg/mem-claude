import { describe, it, expect, afterEach } from 'bun:test';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager.js';
import { SEARCH_CONSTANTS } from '../src/services/worker/search/types.js';

describe('CLAUDE_MEM_SEARCH_RECENCY_DAYS setting', () => {
  const originalEnv = process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS = originalEnv;
    } else {
      delete process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS;
    }
  });

  it('should default to 90', () => {
    delete process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS;
    expect(SettingsDefaultsManager.get('CLAUDE_MEM_SEARCH_RECENCY_DAYS')).toBe('90');
  });

  it('should respect environment variable override', () => {
    process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS = '365';
    expect(SettingsDefaultsManager.get('CLAUDE_MEM_SEARCH_RECENCY_DAYS')).toBe('365');
  });

  it('should be parseable as integer', () => {
    expect(SettingsDefaultsManager.getInt('CLAUDE_MEM_SEARCH_RECENCY_DAYS')).toBe(90);
  });
});

describe('SEARCH_CONSTANTS with recency=0 (unlimited)', () => {
  afterEach(() => {
    delete process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS;
  });

  it('should return Infinity for RECENCY_WINDOW_MS when set to 0', () => {
    process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS = '0';
    expect(SEARCH_CONSTANTS.RECENCY_WINDOW_DAYS).toBe(0);
    expect(SEARCH_CONSTANTS.RECENCY_WINDOW_MS).toBe(Infinity);
  });
});
