# Task 1.1: Create Git Remote URL Utility

**Phase:** 1 - Git Repository Identification
**Issue:** #14
**Depends On:** None
**Next Task:** `task-1.2-update-project-name.md`

---

## Objective

Create utilities to detect git remotes and normalize URLs to a consistent identifier format (e.g., `github.com/user/repo`).

---

## Files to Create

| File | Type |
|------|------|
| `src/utils/git-available.ts` | Implementation |
| `src/utils/git-remote.ts` | Implementation |
| `tests/utils/git-available.test.ts` | Test |
| `tests/utils/git-remote.test.ts` | Test |
| `docs/plans/agents/specs/task-1.1.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-1.1.spec.md` with:

```markdown
# Task 1.1 Specification: Git Remote URL Utility

## Requirements

### git-available.ts
- [ ] Function `isGitAvailable()` returns boolean
- [ ] Caches result after first call (no repeated shell calls)
- [ ] Returns `false` gracefully if git not installed
- [ ] Has 5 second timeout to prevent hanging
- [ ] Function `resetGitAvailableCache()` for testing

### git-remote.ts
- [ ] Interface `GitRemote { name: string; url: string }`
- [ ] Function `normalizeGitUrl(url: string): string | null`
  - [ ] Handles HTTPS GitHub URLs: `https://github.com/user/repo.git` → `github.com/user/repo`
  - [ ] Handles SSH GitHub URLs: `git@github.com:user/repo.git` → `github.com/user/repo`
  - [ ] Handles URLs with ports: `https://github.example.com:8443/org/repo.git` → `github.example.com/org/repo`
  - [ ] Strips `.git` suffix
  - [ ] Returns `null` for invalid URLs, empty strings
- [ ] Function `parseGitRemotes(output: string): GitRemote[]`
  - [ ] Parses `git remote -v` output
  - [ ] Only includes fetch URLs (not push)
  - [ ] Deduplicates by name
- [ ] Function `getPreferredRemote(remotes, preference?): GitRemote | null`
  - [ ] Default preference: `['origin', 'upstream']`
  - [ ] Falls back to first remote if no preferred found
- [ ] Function `getGitRemoteIdentifier(cwd, preference?): string | null`
  - [ ] Returns `null` if git not available
  - [ ] Returns `null` if no `.git` directory
  - [ ] Returns `null` if no remotes configured
  - [ ] Uses 5 second timeout on git command

## Test Cases

### git-available.test.ts
- [ ] Returns boolean (true if git installed)
- [ ] Caches result on second call
- [ ] resetGitAvailableCache clears cache

### git-remote.test.ts
- [ ] normalizeGitUrl: HTTPS GitHub URL
- [ ] normalizeGitUrl: HTTPS GitHub URL without .git
- [ ] normalizeGitUrl: SSH GitHub URL
- [ ] normalizeGitUrl: GitHub enterprise with port
- [ ] normalizeGitUrl: Returns null for invalid URL
- [ ] normalizeGitUrl: Returns null for empty string
- [ ] getPreferredRemote: Prefers origin by default
- [ ] getPreferredRemote: Respects custom preference
- [ ] getPreferredRemote: Falls back to first remote
- [ ] getGitRemoteIdentifier: Returns null for non-git directory
- [ ] getGitRemoteIdentifier: Returns normalized remote for current repo (integration)
```

---

## Step 2: Write Failing Tests

Create `tests/utils/git-available.test.ts`:

```typescript
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
```

Create `tests/utils/git-remote.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import {
  getGitRemoteIdentifier,
  normalizeGitUrl,
  getPreferredRemote,
  parseGitRemotes
} from '../../src/utils/git-remote.js';

describe('Git Remote Utilities', () => {
  describe('normalizeGitUrl', () => {
    it('should normalize HTTPS GitHub URL', () => {
      const result = normalizeGitUrl('https://github.com/sebastienvg/mem-claude.git');
      expect(result).toBe('github.com/sebastienvg/mem-claude');
    });

    it('should normalize HTTPS GitHub URL without .git', () => {
      const result = normalizeGitUrl('https://github.com/user/repo');
      expect(result).toBe('github.com/user/repo');
    });

    it('should normalize SSH GitHub URL', () => {
      const result = normalizeGitUrl('git@github.com:sebastienvg/mem-claude.git');
      expect(result).toBe('github.com/sebastienvg/mem-claude');
    });

    it('should normalize GitHub enterprise URL with port', () => {
      const result = normalizeGitUrl('https://github.example.com:8443/org/repo.git');
      expect(result).toBe('github.example.com/org/repo');
    });

    it('should return null for invalid URL', () => {
      expect(normalizeGitUrl('not-a-url')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(normalizeGitUrl('')).toBeNull();
    });
  });

  describe('parseGitRemotes', () => {
    it('should parse git remote -v output', () => {
      const output = `origin\thttps://github.com/user/repo.git (fetch)
origin\thttps://github.com/user/repo.git (push)
upstream\thttps://github.com/other/repo.git (fetch)
upstream\thttps://github.com/other/repo.git (push)`;

      const remotes = parseGitRemotes(output);
      expect(remotes).toHaveLength(2);
      expect(remotes[0].name).toBe('origin');
      expect(remotes[1].name).toBe('upstream');
    });
  });

  describe('getPreferredRemote', () => {
    it('should prefer origin remote by default', () => {
      const remotes = [
        { name: 'upstream', url: 'https://github.com/other/repo.git' },
        { name: 'origin', url: 'https://github.com/user/repo.git' },
      ];
      const result = getPreferredRemote(remotes);
      expect(result?.name).toBe('origin');
    });

    it('should respect custom preference order', () => {
      const remotes = [
        { name: 'origin', url: 'https://github.com/fork/repo.git' },
        { name: 'upstream', url: 'https://github.com/original/repo.git' },
      ];
      const result = getPreferredRemote(remotes, ['upstream', 'origin']);
      expect(result?.name).toBe('upstream');
    });

    it('should fall back to first remote if no preferred found', () => {
      const remotes = [
        { name: 'custom', url: 'https://github.com/other/repo.git' },
      ];
      const result = getPreferredRemote(remotes, ['origin', 'upstream']);
      expect(result?.name).toBe('custom');
    });
  });

  describe('getGitRemoteIdentifier', () => {
    it('should return null for non-git directory', () => {
      const result = getGitRemoteIdentifier('/tmp');
      expect(result).toBeNull();
    });

    it('should return normalized remote for current repo', () => {
      const result = getGitRemoteIdentifier(process.cwd());
      expect(result).toMatch(/^github\.com\/[\w.-]+\/[\w.-]+$/);
    });
  });
});
```

---

## Step 3: Run Tests (Should Fail)

```bash
bun test tests/utils/git-available.test.ts tests/utils/git-remote.test.ts
```

Expected: `Cannot find module` errors

---

## Step 4: Implement

Create `src/utils/git-available.ts`:

```typescript
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
```

Create `src/utils/git-remote.ts`:

```typescript
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
 * - https://github.com/user/repo.git → github.com/user/repo
 * - git@github.com:user/repo.git → github.com/user/repo
 */
export function normalizeGitUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return null;
  }

  let normalized = url.trim();
  normalized = normalized.replace(/\.git$/, '');

  // SSH format: git@host:path → host/path
  const sshMatch = normalized.match(/^git@([\w.-]+):(.+)$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  // HTTPS format with optional port: https://host[:port]/path → host/path
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
      logger.debug('GIT_REMOTE', 'No remotes configured', { cwd });
      return null;
    }

    return normalizeGitUrl(preferred.url);
  } catch (error) {
    logger.debug('GIT_REMOTE', 'Failed to get remote', { cwd, error });
    return null;
  }
}
```

---

## Step 5: Run Tests (Should Pass)

```bash
bun test tests/utils/git-available.test.ts tests/utils/git-remote.test.ts
```

---

## Step 6: Verify Spec Compliance

Review `docs/plans/agents/specs/task-1.1.spec.md` and check all boxes.

---

## Step 7: Commit

```bash
git add src/utils/git-available.ts src/utils/git-remote.ts \
        tests/utils/git-available.test.ts tests/utils/git-remote.test.ts \
        docs/plans/agents/specs/task-1.1.spec.md
git commit -m "feat: add git remote URL normalization with configurable preference

- Add isGitAvailable() with caching and timeout
- Add normalizeGitUrl() for SSH and HTTPS URLs
- Add getPreferredRemote() with configurable priority
- Add getGitRemoteIdentifier() for directory lookup

Part of #14"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-1.2-update-project-name.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 1.1 -->
## Context from Previous Agent

Task 1.1 is complete. The following utilities are now available:

- `src/utils/git-available.ts`: `isGitAvailable()`, `resetGitAvailableCache()`
- `src/utils/git-remote.ts`: `normalizeGitUrl()`, `parseGitRemotes()`, `getPreferredRemote()`, `getGitRemoteIdentifier()`

Import `getGitRemoteIdentifier` from `./git-remote.js` to get the normalized remote URL.
Returns `null` if git not available or no remotes configured.

Tests passing: `bun test tests/utils/git-*.test.ts`
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked in `task-1.1.spec.md`
- [ ] All tests pass
- [ ] Code committed with meaningful message
- [ ] Handoff comment added to task-1.2
