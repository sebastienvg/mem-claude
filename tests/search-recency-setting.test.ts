import { describe, it, expect, afterEach } from 'bun:test';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager.js';

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
