/**
 * Git Availability Detection Utility
 *
 * Checks if git CLI is available on the system with caching
 * to avoid repeated shell calls.
 */

import { execSync } from 'child_process';
import { logger } from './logger.js';

let gitAvailable: boolean | null = null;

/**
 * Check if git CLI is available on this system.
 * Caches result to avoid repeated shell calls.
 *
 * @returns true if git is available, false otherwise
 */
export function isGitAvailable(): boolean {
  if (gitAvailable !== null) return gitAvailable;

  try {
    execSync('git --version', { stdio: 'pipe', timeout: 5000 });
    gitAvailable = true;
  } catch {
    gitAvailable = false;
    logger.warn('GIT', 'Git CLI not available, falling back to basename');
  }

  return gitAvailable;
}

/**
 * Reset the cached git availability. Used for testing.
 */
export function resetGitAvailableCache(): void {
  gitAvailable = null;
}
