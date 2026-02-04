/**
 * Git Remote URL Utilities
 *
 * Provides utilities to detect git remotes and normalize URLs to a consistent
 * identifier format (e.g., `github.com/user/repo`).
 *
 * Used for project identification across sessions.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { isGitAvailable } from './git-available.js';
import { logger } from './logger.js';

export interface GitRemote {
  name: string;
  url: string;
}

const DEFAULT_REMOTE_PREFERENCE = ['origin', 'upstream'];

/**
 * Normalize a git remote URL to a consistent identifier format.
 * Focused on GitHub URLs but supports other providers.
 *
 * Examples:
 * - https://github.com/user/repo.git -> github.com/user/repo
 * - git@github.com:user/repo.git -> github.com/user/repo
 * - https://github.example.com:8443/org/repo.git -> github.example.com/org/repo
 */
export function normalizeGitUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return null;
  }

  let normalized = url.trim();
  normalized = normalized.replace(/\.git$/, '');

  // SSH format: git@host:path -> host/path
  const sshMatch = normalized.match(/^git@([\w.-]+):(.+)$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  // HTTPS format with optional port: https://host[:port]/path -> host/path
  const httpsMatch = normalized.match(/^https?:\/\/([\w.-]+)(?::\d+)?\/(.+)$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  return null;
}

/**
 * Parse git remote -v output into structured remotes.
 * Only includes fetch URLs (not push) and deduplicates by name.
 */
export function parseGitRemotes(output: string): GitRemote[] {
  const remotes: GitRemote[] = [];
  const seen = new Set<string>();

  for (const line of output.split('\n')) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      remotes.push({ name: match[1], url: match[2] });
    }
  }

  return remotes;
}

/**
 * Select the preferred remote from a list.
 * @param remotes - List of git remotes
 * @param preference - Ordered list of preferred remote names
 */
export function getPreferredRemote(
  remotes: GitRemote[],
  preference: string[] = DEFAULT_REMOTE_PREFERENCE
): GitRemote | null {
  if (remotes.length === 0) return null;

  for (const name of preference) {
    const remote = remotes.find(r => r.name === name);
    if (remote) return remote;
  }

  return remotes[0];
}

/**
 * Get the git remote identifier for a directory.
 * Returns normalized URL like 'github.com/user/repo' or null if not available.
 */
export function getGitRemoteIdentifier(
  cwd: string,
  remotePreference?: string[]
): string | null {
  if (!isGitAvailable()) return null;

  const gitPath = path.join(cwd, '.git');
  if (!existsSync(gitPath)) return null;

  try {
    const remotesOutput = execSync('git remote -v', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000
    });

    const remotes = parseGitRemotes(remotesOutput);
    const preferred = getPreferredRemote(remotes, remotePreference);

    if (!preferred) {
      logger.debug('SYSTEM', 'No remotes configured', { cwd });
      return null;
    }

    return normalizeGitUrl(preferred.url);
  } catch (error) {
    logger.debug('SYSTEM', 'Failed to get remote', { cwd, error: String(error) });
    return null;
  }
}
