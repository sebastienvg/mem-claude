import { describe, it, expect } from 'bun:test';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager.js';

describe('CLAUDE_MEM_VERBOSITY setting', () => {
  it('should have a default value of standard', () => {
    const defaults = SettingsDefaultsManager.getAllDefaults();
    expect(defaults.CLAUDE_MEM_VERBOSITY).toBe('standard');
  });

  it('should be accessible via get()', () => {
    const value = SettingsDefaultsManager.get('CLAUDE_MEM_VERBOSITY');
    expect(['minimal', 'standard', 'detailed']).toContain(value);
  });
});
