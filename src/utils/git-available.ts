/**
 * Git Availability Utility
 *
 * Provides a cached check for whether the git CLI is available on the system.
 * Used by git-remote.ts and other git-related utilities.
 */

import { execSync } from 'child_process';
import { logger } from './logger.js';

let gitAvailable: boolean | null = null;

/**
 * Check if git CLI is available on this system.
 * Caches result to avoid repeated shell calls.
 */
export function isGitAvailable(): boolean {
  if (gitAvailable !== null) return gitAvailable;

  try {
    execSync('git --version', { stdio: 'pipe', timeout: 5000 });
    gitAvailable = true;
  } catch {
    gitAvailable = false;
    logger.warn('SYSTEM', 'Git CLI not available, falling back to basename');
  }

  return gitAvailable;
}

/**
 * Reset the cached git availability. Used for testing.
 */
export function resetGitAvailableCache(): void {
  gitAvailable = null;
}
