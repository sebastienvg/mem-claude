/**
 * Settings Integration Tests for New Features
 *
 * Tests for multi-agent and project identity settings added in Task 3.2.
 * Uses temp directories for file system isolation.
 *
 * Settings tested:
 * - CLAUDE_MEM_GIT_REMOTE_PREFERENCE
 * - CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY
 * - CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS
 * - CLAUDE_MEM_AGENT_LOCKOUT_DURATION
 * - CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SettingsDefaultsManager } from '../../src/shared/SettingsDefaultsManager.js';
import {
  getGitRemotePreference,
  getDefaultVisibility,
  getAgentKeyExpiryDays,
  getLockoutDuration,
  getMaxFailedAttempts,
} from '../../src/shared/settings-helpers.js';

describe('New Feature Settings', () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempDir = join(tmpdir(), `settings-new-features-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    settingsPath = join(tempDir, 'settings.json');
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Default Values', () => {
    it('should have correct default for GIT_REMOTE_PREFERENCE', () => {
      const defaults = SettingsDefaultsManager.getAllDefaults();
      expect(defaults.CLAUDE_MEM_GIT_REMOTE_PREFERENCE).toBe('origin,upstream');
    });

    it('should have correct default for AGENT_DEFAULT_VISIBILITY', () => {
      const defaults = SettingsDefaultsManager.getAllDefaults();
      expect(defaults.CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY).toBe('project');
    });

    it('should have correct default for AGENT_KEY_EXPIRY_DAYS', () => {
      const defaults = SettingsDefaultsManager.getAllDefaults();
      expect(defaults.CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS).toBe('90');
    });

    it('should have correct default for AGENT_LOCKOUT_DURATION', () => {
      const defaults = SettingsDefaultsManager.getAllDefaults();
      expect(defaults.CLAUDE_MEM_AGENT_LOCKOUT_DURATION).toBe('300');
    });

    it('should have correct default for AGENT_MAX_FAILED_ATTEMPTS', () => {
      const defaults = SettingsDefaultsManager.getAllDefaults();
      expect(defaults.CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS).toBe('5');
    });
  });

  describe('Settings Override', () => {
    it('should read custom GIT_REMOTE_PREFERENCE from file', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_GIT_REMOTE_PREFERENCE: 'upstream,origin,fork'
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      expect(settings.CLAUDE_MEM_GIT_REMOTE_PREFERENCE).toBe('upstream,origin,fork');
    });

    it('should read custom AGENT_DEFAULT_VISIBILITY from file', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY: 'department'
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      expect(settings.CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY).toBe('department');
    });

    it('should read custom AGENT_KEY_EXPIRY_DAYS from file', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS: '30'
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      expect(settings.CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS).toBe('30');
    });

    it('should read custom AGENT_LOCKOUT_DURATION from file', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_AGENT_LOCKOUT_DURATION: '600'
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      expect(settings.CLAUDE_MEM_AGENT_LOCKOUT_DURATION).toBe('600');
    });

    it('should read custom AGENT_MAX_FAILED_ATTEMPTS from file', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS: '3'
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      expect(settings.CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS).toBe('3');
    });
  });

  describe('Helper Functions', () => {
    describe('getGitRemotePreference', () => {
      it('should return default as array', () => {
        const result = getGitRemotePreference();
        expect(result).toEqual(['origin', 'upstream']);
      });

      it('should parse custom preference from file', () => {
        writeFileSync(settingsPath, JSON.stringify({
          CLAUDE_MEM_GIT_REMOTE_PREFERENCE: 'upstream,origin,fork'
        }));

        const result = getGitRemotePreference(settingsPath);
        expect(result).toEqual(['upstream', 'origin', 'fork']);
      });

      it('should trim whitespace from entries', () => {
        writeFileSync(settingsPath, JSON.stringify({
          CLAUDE_MEM_GIT_REMOTE_PREFERENCE: ' origin , upstream , fork '
        }));

        const result = getGitRemotePreference(settingsPath);
        expect(result).toEqual(['origin', 'upstream', 'fork']);
      });

      it('should filter empty entries', () => {
        writeFileSync(settingsPath, JSON.stringify({
          CLAUDE_MEM_GIT_REMOTE_PREFERENCE: 'origin,,upstream,,'
        }));

        const result = getGitRemotePreference(settingsPath);
        expect(result).toEqual(['origin', 'upstream']);
      });
    });

    describe('getDefaultVisibility', () => {
      it('should return default visibility', () => {
        const result = getDefaultVisibility();
        expect(result).toBe('project');
      });

      it('should return custom visibility from file', () => {
        writeFileSync(settingsPath, JSON.stringify({
          CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY: 'department'
        }));

        const result = getDefaultVisibility(settingsPath);
        expect(result).toBe('department');
      });

      it('should accept all valid visibility values', () => {
        const validValues = ['private', 'department', 'project', 'public'] as const;

        for (const value of validValues) {
          writeFileSync(settingsPath, JSON.stringify({
            CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY: value
          }));

          const result = getDefaultVisibility(settingsPath);
          expect(result).toBe(value);
        }
      });

      it('should fallback to project for invalid visibility', () => {
        writeFileSync(settingsPath, JSON.stringify({
          CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY: 'invalid-visibility'
        }));

        const result = getDefaultVisibility(settingsPath);
        expect(result).toBe('project');
      });
    });

    describe('getAgentKeyExpiryDays', () => {
      it('should return default expiry days', () => {
        const result = getAgentKeyExpiryDays();
        expect(result).toBe(90);
      });

      it('should return custom expiry days from file', () => {
        writeFileSync(settingsPath, JSON.stringify({
          CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS: '30'
        }));

        const result = getAgentKeyExpiryDays(settingsPath);
        expect(result).toBe(30);
      });

      it('should fallback to default for invalid number', () => {
        writeFileSync(settingsPath, JSON.stringify({
          CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS: 'not-a-number'
        }));

        const result = getAgentKeyExpiryDays(settingsPath);
        expect(result).toBe(90);
      });
    });

    describe('getLockoutDuration', () => {
      it('should return default lockout duration', () => {
        const result = getLockoutDuration();
        expect(result).toBe(300);
      });

      it('should return custom lockout duration from file', () => {
        writeFileSync(settingsPath, JSON.stringify({
          CLAUDE_MEM_AGENT_LOCKOUT_DURATION: '600'
        }));

        const result = getLockoutDuration(settingsPath);
        expect(result).toBe(600);
      });

      it('should fallback to default for invalid number', () => {
        writeFileSync(settingsPath, JSON.stringify({
          CLAUDE_MEM_AGENT_LOCKOUT_DURATION: 'invalid'
        }));

        const result = getLockoutDuration(settingsPath);
        expect(result).toBe(300);
      });
    });

    describe('getMaxFailedAttempts', () => {
      it('should return default max failed attempts', () => {
        const result = getMaxFailedAttempts();
        expect(result).toBe(5);
      });

      it('should return custom max failed attempts from file', () => {
        writeFileSync(settingsPath, JSON.stringify({
          CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS: '10'
        }));

        const result = getMaxFailedAttempts(settingsPath);
        expect(result).toBe(10);
      });

      it('should fallback to default for invalid number', () => {
        writeFileSync(settingsPath, JSON.stringify({
          CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS: 'invalid'
        }));

        const result = getMaxFailedAttempts(settingsPath);
        expect(result).toBe(5);
      });
    });
  });

  describe('Integration with loadFromFile', () => {
    it('should include new settings in created defaults file', () => {
      // Remove file if it exists
      if (existsSync(settingsPath)) {
        rmSync(settingsPath);
      }

      // Load from non-existent file should create it
      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);

      // Check new settings are present
      expect(settings.CLAUDE_MEM_GIT_REMOTE_PREFERENCE).toBe('origin,upstream');
      expect(settings.CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY).toBe('project');
      expect(settings.CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS).toBe('90');
      expect(settings.CLAUDE_MEM_AGENT_LOCKOUT_DURATION).toBe('300');
      expect(settings.CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS).toBe('5');
    });

    it('should merge new settings with existing partial file', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_MODEL: 'custom-model',
        CLAUDE_MEM_GIT_REMOTE_PREFERENCE: 'fork,origin'
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);

      // Custom values should be preserved
      expect(settings.CLAUDE_MEM_MODEL).toBe('custom-model');
      expect(settings.CLAUDE_MEM_GIT_REMOTE_PREFERENCE).toBe('fork,origin');

      // Defaults should fill in missing keys
      expect(settings.CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY).toBe('project');
      expect(settings.CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS).toBe('90');
    });
  });
});
