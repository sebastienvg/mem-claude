/**
 * Settings Helpers
 *
 * Convenience functions for parsing and validating settings values.
 * Provides type-safe access to complex settings like arrays and enums.
 */

import { SettingsDefaultsManager } from './SettingsDefaultsManager.js';

/**
 * Visibility levels for observations and summaries.
 */
export type Visibility = 'private' | 'department' | 'project' | 'public';

const VALID_VISIBILITY: readonly Visibility[] = ['private', 'department', 'project', 'public'];

/**
 * Get git remote preference as an array of remote names.
 *
 * @param settingsPath - Optional path to settings file
 * @returns Array of remote names in preference order
 */
export function getGitRemotePreference(settingsPath?: string): string[] {
  const settings = settingsPath
    ? SettingsDefaultsManager.loadFromFile(settingsPath)
    : SettingsDefaultsManager.getAllDefaults();

  return settings.CLAUDE_MEM_GIT_REMOTE_PREFERENCE
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Get default visibility for observations.
 *
 * Falls back to 'project' if the configured value is invalid.
 *
 * @param settingsPath - Optional path to settings file
 * @returns Valid visibility level
 */
export function getDefaultVisibility(settingsPath?: string): Visibility {
  const settings = settingsPath
    ? SettingsDefaultsManager.loadFromFile(settingsPath)
    : SettingsDefaultsManager.getAllDefaults();

  const value = settings.CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY;

  if (VALID_VISIBILITY.includes(value as Visibility)) {
    return value as Visibility;
  }

  return 'project'; // Fallback
}

/**
 * Get agent key expiry in days.
 *
 * Falls back to 90 days if the configured value is invalid.
 *
 * @param settingsPath - Optional path to settings file
 * @returns Number of days until key expires
 */
export function getAgentKeyExpiryDays(settingsPath?: string): number {
  const settings = settingsPath
    ? SettingsDefaultsManager.loadFromFile(settingsPath)
    : SettingsDefaultsManager.getAllDefaults();

  const parsed = parseInt(settings.CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS, 10);
  return isNaN(parsed) ? 90 : parsed;
}

/**
 * Get lockout duration in seconds.
 *
 * Falls back to 300 seconds (5 minutes) if the configured value is invalid.
 *
 * @param settingsPath - Optional path to settings file
 * @returns Lockout duration in seconds
 */
export function getLockoutDuration(settingsPath?: string): number {
  const settings = settingsPath
    ? SettingsDefaultsManager.loadFromFile(settingsPath)
    : SettingsDefaultsManager.getAllDefaults();

  const parsed = parseInt(settings.CLAUDE_MEM_AGENT_LOCKOUT_DURATION, 10);
  return isNaN(parsed) ? 300 : parsed;
}

/**
 * Get max failed attempts before lockout.
 *
 * Falls back to 5 attempts if the configured value is invalid.
 *
 * @param settingsPath - Optional path to settings file
 * @returns Maximum failed authentication attempts
 */
export function getMaxFailedAttempts(settingsPath?: string): number {
  const settings = settingsPath
    ? SettingsDefaultsManager.loadFromFile(settingsPath)
    : SettingsDefaultsManager.getAllDefaults();

  const parsed = parseInt(settings.CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS, 10);
  return isNaN(parsed) ? 5 : parsed;
}
