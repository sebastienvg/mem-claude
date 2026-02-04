# Repo-Based Project Identity & Multi-Agent Architecture

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace folder-path project identification with git repository identifiers (GitHub-focused), then extend with multi-agent support for shared memories across verified agents.

**Architecture:** Hybrid identification (git remote URL → basename fallback), with a new agents table and scoped visibility on observations. Migration preserves existing data via project_aliases table. Auth middleware enforces visibility rules with O(1) key lookup.

**Tech Stack:** TypeScript, SQLite, Bun test runner, git CLI (GitHub remotes)

**Issues:** #14 (repo-based project ID), #15 (multi-agent architecture)

---

## Security Considerations

> **WARNING: API Key Security**
> - API keys grant full read access to everything the agent can see
> - Never commit API keys to version control
> - Rotate immediately if a key is suspected compromised
> - Use environment variables or secure credential storage
> - Keys expire after 90 days by default (configurable)

---

## Prerequisites

**Git CLI Availability Check:** All git operations must first verify `git` is available. Add a utility function that caches the result:

```typescript
// src/utils/git-available.ts
import { execSync } from 'child_process';
import { logger } from './logger.js';

let gitAvailable: boolean | null = null;

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

export function resetGitAvailableCache(): void {
  gitAvailable = null;
}
```

---

## Phase 1: Git Repository Identification (Issue #14)

### Task 1.1: Create Git Remote URL Utility

**Files:**
- Create: `src/utils/git-available.ts`
- Create: `src/utils/git-remote.ts`
- Test: `tests/utils/git-remote.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/utils/git-remote.test.ts
import { describe, it, expect } from 'bun:test';
import { getGitRemoteIdentifier, normalizeGitUrl, getPreferredRemote } from '../../src/utils/git-remote.js';

describe('Git Remote Utilities', () => {
  describe('normalizeGitUrl', () => {
    // GitHub HTTPS
    it('should normalize HTTPS GitHub URL', () => {
      const result = normalizeGitUrl('https://github.com/sebastienvg/mem-claude.git');
      expect(result).toBe('github.com/sebastienvg/mem-claude');
    });

    it('should normalize HTTPS GitHub URL without .git', () => {
      const result = normalizeGitUrl('https://github.com/user/repo');
      expect(result).toBe('github.com/user/repo');
    });

    // GitHub SSH
    it('should normalize SSH GitHub URL', () => {
      const result = normalizeGitUrl('git@github.com:sebastienvg/mem-claude.git');
      expect(result).toBe('github.com/sebastienvg/mem-claude');
    });

    // GitHub with port (enterprise)
    it('should normalize GitHub enterprise URL with port', () => {
      const result = normalizeGitUrl('https://github.example.com:8443/org/repo.git');
      expect(result).toBe('github.example.com/org/repo');
    });

    // Edge cases
    it('should return null for invalid URL', () => {
      expect(normalizeGitUrl('not-a-url')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(normalizeGitUrl('')).toBeNull();
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

    // Integration test - requires actual git repo
    it('should return normalized remote for current repo', () => {
      const result = getGitRemoteIdentifier(process.cwd());
      expect(result).toMatch(/^github\.com\/[\w.-]+\/[\w.-]+$/);
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/utils/git-remote.test.ts
```

Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```typescript
// src/utils/git-remote.ts
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { isGitAvailable } from './git-available.js';
import { logger } from './logger.js';

export interface GitRemote {
  name: string;
  url: string;
}

// Default remote preference order (configurable via settings)
const DEFAULT_REMOTE_PREFERENCE = ['origin', 'upstream'];

/**
 * Normalize a git remote URL to a consistent identifier format.
 * Focused on GitHub URLs but supports other providers.
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
 * @param preference - Ordered list of preferred remote names (default: ['origin', 'upstream'])
 */
export function getPreferredRemote(
  remotes: GitRemote[],
  preference: string[] = DEFAULT_REMOTE_PREFERENCE
): GitRemote | null {
  if (remotes.length === 0) return null;

  // Try each preferred name in order
  for (const name of preference) {
    const remote = remotes.find(r => r.name === name);
    if (remote) return remote;
  }

  // Fall back to first
  return remotes[0];
}

/**
 * Get the git remote identifier for a directory.
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

**Step 4: Run test to verify it passes**

```bash
bun test tests/utils/git-remote.test.ts
```

**Step 5: Commit**

```bash
git add src/utils/git-available.ts src/utils/git-remote.ts tests/utils/git-remote.test.ts
git commit -m "feat: add git remote URL normalization with configurable preference"
```

---

### Task 1.2: Update getProjectName to Use Git Remote

**Files:**
- Modify: `src/utils/project-name.ts`
- Test: `tests/utils/project-name.test.ts` (create)

**Step 1: Write the failing test**

```typescript
// tests/utils/project-name.test.ts
import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { getProjectName, getProjectContext } from '../../src/utils/project-name.js';
import * as gitRemote from '../../src/utils/git-remote.js';

describe('Project Name Utilities', () => {
  describe('getProjectName', () => {
    it('should return git remote identifier when available', () => {
      const spy = spyOn(gitRemote, 'getGitRemoteIdentifier')
        .mockReturnValue('github.com/user/repo');

      const result = getProjectName('/some/path/repo');
      expect(result).toBe('github.com/user/repo');

      spy.mockRestore();
    });

    it('should fall back to basename when no git remote', () => {
      const spy = spyOn(gitRemote, 'getGitRemoteIdentifier')
        .mockReturnValue(null);

      const result = getProjectName('/some/path/my-project');
      expect(result).toBe('my-project');

      spy.mockRestore();
    });

    it('should handle empty cwd', () => {
      expect(getProjectName('')).toBe('unknown-project');
    });

    it('should handle null cwd', () => {
      expect(getProjectName(null)).toBe('unknown-project');
    });
  });
});
```

**Step 2-5:** Same as before - implement, test, commit.

```bash
git commit -m "feat: prioritize git remote URL for project identification"
```

---

### Task 1.3: Add Database Migration for Project Aliases

**Files:**
- Modify: `src/services/sqlite/migrations.ts`
- Test: `tests/sqlite/project-aliases.test.ts`

Same as revision 2, plus index on `new_project` for reverse lookups.

```bash
git commit -m "feat: add project_aliases table for migration compatibility"
```

---

### Task 1.4: Create Project Alias Resolution Service

**Files:**
- Create: `src/services/sqlite/project-aliases.ts`
- Test: `tests/sqlite/project-alias-resolution.test.ts`

**Key addition: Hard cap on alias count to avoid SQLite parameter limit**

```typescript
// src/services/sqlite/project-aliases.ts

/** Maximum aliases to include in IN clause (SQLite limit is 999) */
const MAX_ALIASES_IN_QUERY = 100;

/**
 * Get all project identifiers that should be queried for a given project.
 *
 * IMPORTANT: Limited to MAX_ALIASES_IN_QUERY to avoid SQLite parameter limits.
 * If a project has more aliases, logs warning and returns truncated list.
 */
export function getProjectsWithAliases(db: Database, project: string): string[] {
  const projects = [project];

  const aliases = db.query(`
    SELECT old_project FROM project_aliases
    WHERE new_project = ?
    LIMIT ?
  `).all(project, MAX_ALIASES_IN_QUERY) as { old_project: string }[];

  for (const alias of aliases) {
    projects.push(alias.old_project);
  }

  // Warn if we hit the limit
  if (aliases.length === MAX_ALIASES_IN_QUERY) {
    const totalCount = getAliasCount(db, project);
    if (totalCount > MAX_ALIASES_IN_QUERY) {
      logger.warn('PROJECT_ALIAS', 'Alias count exceeds query limit', {
        project,
        totalAliases: totalCount,
        includedInQuery: MAX_ALIASES_IN_QUERY,
        recommendation: 'Run cleanup to consolidate old aliases'
      });
    }
  }

  return projects;
}

/**
 * Get count of aliases for a project.
 */
export function getAliasCount(db: Database, project: string): number {
  const result = db.query(`
    SELECT COUNT(*) as count FROM project_aliases WHERE new_project = ?
  `).get(project) as { count: number };
  return result.count;
}

/**
 * Cleanup old aliases (for maintenance).
 * Removes aliases older than specified days.
 */
export function cleanupOldAliases(db: Database, olderThanDays: number = 365): number {
  const cutoffEpoch = Math.floor(Date.now() / 1000) - (olderThanDays * 86400);
  const result = db.run(`
    DELETE FROM project_aliases WHERE created_at_epoch < ?
  `, [cutoffEpoch]);

  logger.info('PROJECT_ALIAS', 'Cleaned up old aliases', {
    deleted: result.changes,
    olderThanDays
  });
  return result.changes;
}
```

```bash
git commit -m "feat: add project alias resolution with hard cap and cleanup"
```

---

### Task 1.5-1.7: Same as revision 2

- 1.5: Update Session Init to Register Aliases
- 1.6: Update Query Functions for Alias Support
- 1.7: Add Migration CLI Command

---

## Phase 2: Multi-Agent Architecture (Issue #15)

### Task 2.1: Add Agents Table Migration (with O(1) Key Lookup)

**Files:**
- Modify: `src/services/sqlite/migrations.ts`
- Test: `tests/sqlite/agents.test.ts`

**Key addition: API key prefix index for O(1) lookup**

```typescript
// Add to src/services/sqlite/migrations.ts

/**
 * Migration 009 - Add multi-agent architecture tables
 *
 * Key design decisions:
 * - api_key_prefix: First 12 chars of key for O(1) lookup (indexed)
 * - api_key_hash: Full SHA-256 hash for verification
 * - expires_at: Optional key expiration (default 90 days)
 * - failed_attempts: Counter for brute-force protection
 * - locked_until: Temporary lockout after too many failures
 */
export const migration009: Migration = {
  version: 9,
  up: (db: Database) => {
    // Agents table with O(1) key lookup
    db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        department TEXT NOT NULL DEFAULT 'default',
        permissions TEXT NOT NULL DEFAULT 'read,write',
        api_key_prefix TEXT,
        api_key_hash TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at_epoch INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_seen_at TEXT,
        last_seen_at_epoch INTEGER,
        verified INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        expires_at_epoch INTEGER,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until_epoch INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_agents_department ON agents(department);
      CREATE INDEX IF NOT EXISTS idx_agents_verified ON agents(verified);
      CREATE INDEX IF NOT EXISTS idx_agents_api_key_prefix ON agents(api_key_prefix);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);
    `);

    // Add agent metadata columns to observations
    db.run(`
      ALTER TABLE observations ADD COLUMN agent TEXT DEFAULT 'legacy';
      ALTER TABLE observations ADD COLUMN department TEXT DEFAULT 'default';
      ALTER TABLE observations ADD COLUMN visibility TEXT DEFAULT 'project'
        CHECK(visibility IN ('private', 'department', 'project', 'public'));
    `);

    db.run(`
      CREATE INDEX IF NOT EXISTS idx_observations_agent ON observations(agent);
      CREATE INDEX IF NOT EXISTS idx_observations_department ON observations(department);
      CREATE INDEX IF NOT EXISTS idx_observations_visibility ON observations(visibility);
    `);

    // Add to session_summaries
    db.run(`
      ALTER TABLE session_summaries ADD COLUMN agent TEXT DEFAULT 'legacy';
      ALTER TABLE session_summaries ADD COLUMN department TEXT DEFAULT 'default';
      ALTER TABLE session_summaries ADD COLUMN visibility TEXT DEFAULT 'project';
    `);

    // Audit log for security tracking
    db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at_epoch INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_agent ON audit_log(agent_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at_epoch DESC);
    `);

    console.log('✅ Created multi-agent architecture tables with O(1) key lookup');
  },

  down: (db: Database) => {
    db.run(`DROP TABLE IF EXISTS audit_log`);
    db.run(`DROP TABLE IF EXISTS agents`);
  }
};
```

```bash
git commit -m "feat: add agents table with O(1) key lookup and brute-force protection"
```

---

### Task 2.2: Create Agent Service with Security

**Files:**
- Create: `src/services/agents/AgentService.ts`
- Test: `tests/services/agents/agent-service.test.ts`

**Key additions:**
- O(1) key lookup via prefix
- Brute-force protection with exponential backoff
- Key expiration support
- Explicit revocation

```typescript
// src/services/agents/AgentService.ts
import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'crypto';
import { logger } from '../../utils/logger.js';

export class AgentIdFormatError extends Error {
  constructor(id: string) {
    super(`Invalid agent ID format: ${id}. Expected: user@host`);
    this.name = 'AgentIdFormatError';
  }
}

export class AgentLockedError extends Error {
  constructor(id: string, lockedUntil: Date) {
    super(`Agent ${id} is locked until ${lockedUntil.toISOString()}`);
    this.name = 'AgentLockedError';
  }
}

const AGENT_ID_PATTERN = /^[\w.-]+@[\w.-]+$/;
const KEY_PREFIX_LENGTH = 12;
const DEFAULT_KEY_EXPIRY_DAYS = 90;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 300; // 5 minutes

export class AgentService {
  constructor(private db: Database) {}

  private validateAgentId(id: string): void {
    if (!AGENT_ID_PATTERN.test(id)) {
      throw new AgentIdFormatError(id);
    }
    if (id.includes(';') || id.includes('--') || id.includes("'")) {
      throw new AgentIdFormatError(id);
    }
  }

  private generateApiKey(): string {
    const bytes = randomBytes(24);
    return `cm_${bytes.toString('base64url')}`;
  }

  private getKeyPrefix(apiKey: string): string {
    return apiKey.slice(0, KEY_PREFIX_LENGTH);
  }

  private hashApiKey(apiKey: string): string {
    return `sha256:${createHash('sha256').update(apiKey).digest('hex')}`;
  }

  private audit(agentId: string, action: string, details?: object, ip?: string): void {
    this.db.run(`
      INSERT INTO audit_log (agent_id, action, details, ip_address)
      VALUES (?, ?, ?, ?)
    `, [agentId, action, details ? JSON.stringify(details) : null, ip ?? null]);
  }

  /**
   * Register or update an agent.
   * Returns generated API key only on first registration.
   */
  registerAgent(reg: { id: string; department: string; permissions?: string }): {
    agent: any;
    apiKey?: string;
  } {
    this.validateAgentId(reg.id);

    const existing = this.getAgent(reg.id);
    const now = new Date().toISOString();
    const nowEpoch = Math.floor(Date.now() / 1000);

    if (existing) {
      this.db.run(`
        UPDATE agents SET last_seen_at = ?, last_seen_at_epoch = ?
        WHERE id = ?
      `, [now, nowEpoch, reg.id]);
      this.audit(reg.id, 'agent_seen');
      return { agent: this.getAgent(reg.id)! };
    }

    // New agent - generate key with expiration
    const apiKey = this.generateApiKey();
    const prefix = this.getKeyPrefix(apiKey);
    const hash = this.hashApiKey(apiKey);
    const expiresEpoch = nowEpoch + (DEFAULT_KEY_EXPIRY_DAYS * 86400);
    const expiresAt = new Date(expiresEpoch * 1000).toISOString();

    this.db.run(`
      INSERT INTO agents (
        id, department, permissions, api_key_prefix, api_key_hash,
        last_seen_at, last_seen_at_epoch, expires_at, expires_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      reg.id,
      reg.department,
      reg.permissions ?? 'read,write',
      prefix,
      hash,
      now,
      nowEpoch,
      expiresAt,
      expiresEpoch
    ]);

    this.audit(reg.id, 'agent_registered', { department: reg.department });
    logger.info('AGENTS', 'Registered new agent', { id: reg.id, expiresAt });

    return { agent: this.getAgent(reg.id)!, apiKey };
  }

  getAgent(id: string): any | null {
    const row = this.db.query('SELECT * FROM agents WHERE id = ?').get(id) as any;
    if (!row) return null;
    return { ...row, verified: Boolean(row.verified) };
  }

  /**
   * O(1) agent lookup by API key prefix, then verify hash.
   * Includes brute-force protection.
   */
  findAgentByKey(apiKey: string): any | null {
    const prefix = this.getKeyPrefix(apiKey);
    const hash = this.hashApiKey(apiKey);

    // O(1) lookup by prefix
    const candidate = this.db.query(`
      SELECT * FROM agents WHERE api_key_prefix = ?
    `).get(prefix) as any;

    if (!candidate) return null;

    // Check lockout
    const now = Math.floor(Date.now() / 1000);
    if (candidate.locked_until_epoch && candidate.locked_until_epoch > now) {
      throw new AgentLockedError(
        candidate.id,
        new Date(candidate.locked_until_epoch * 1000)
      );
    }

    // Verify full hash
    if (candidate.api_key_hash === hash) {
      // Check expiration
      if (candidate.expires_at_epoch && candidate.expires_at_epoch < now) {
        this.audit(candidate.id, 'key_expired');
        return null;
      }

      // Reset failed attempts on success
      if (candidate.failed_attempts > 0) {
        this.db.run(`
          UPDATE agents SET failed_attempts = 0 WHERE id = ?
        `, [candidate.id]);
      }

      return { ...candidate, verified: Boolean(candidate.verified) };
    }

    // Failed attempt - increment counter
    const newAttempts = (candidate.failed_attempts || 0) + 1;
    let lockedUntil: number | null = null;

    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = now + LOCKOUT_DURATION_SECONDS;
      this.audit(candidate.id, 'agent_locked', { attempts: newAttempts });
      logger.warn('AGENTS', 'Agent locked due to failed attempts', {
        id: candidate.id,
        attempts: newAttempts
      });
    }

    this.db.run(`
      UPDATE agents SET failed_attempts = ?, locked_until_epoch = ?
      WHERE id = ?
    `, [newAttempts, lockedUntil, candidate.id]);

    this.audit(candidate.id, 'verify_failed', { attempts: newAttempts });
    return null;
  }

  /**
   * Verify agent with API key (uses O(1) lookup).
   */
  verifyAgent(id: string, apiKey: string): boolean {
    const agent = this.findAgentByKey(apiKey);
    if (!agent || agent.id !== id) return false;

    if (!agent.verified) {
      this.db.run('UPDATE agents SET verified = 1 WHERE id = ?', [id]);
      this.audit(id, 'verify_success');
    }
    return true;
  }

  /**
   * Rotate API key for an agent.
   */
  rotateApiKey(id: string, expiryDays: number = DEFAULT_KEY_EXPIRY_DAYS): string | null {
    const agent = this.getAgent(id);
    if (!agent) return null;

    const newKey = this.generateApiKey();
    const prefix = this.getKeyPrefix(newKey);
    const hash = this.hashApiKey(newKey);
    const now = Math.floor(Date.now() / 1000);
    const expiresEpoch = now + (expiryDays * 86400);
    const expiresAt = new Date(expiresEpoch * 1000).toISOString();

    this.db.run(`
      UPDATE agents SET
        api_key_prefix = ?, api_key_hash = ?, verified = 0,
        expires_at = ?, expires_at_epoch = ?, failed_attempts = 0
      WHERE id = ?
    `, [prefix, hash, expiresAt, expiresEpoch, id]);

    this.audit(id, 'key_rotated', { expiresAt });
    return newKey;
  }

  /**
   * Explicitly revoke an agent's API key.
   */
  revokeApiKey(id: string): boolean {
    const agent = this.getAgent(id);
    if (!agent) return false;

    this.db.run(`
      UPDATE agents SET
        api_key_prefix = NULL, api_key_hash = NULL, verified = 0
      WHERE id = ?
    `, [id]);

    this.audit(id, 'key_revoked');
    logger.info('AGENTS', 'Revoked API key', { id });
    return true;
  }

  /**
   * Check if agent has a specific permission.
   */
  hasPermission(agentId: string, permission: 'read' | 'write'): boolean {
    const agent = this.getAgent(agentId);
    if (!agent) return false;
    return agent.permissions.split(',').includes(permission);
  }

  /**
   * Check if an agent can access an observation based on visibility rules.
   *
   * IMPORTANT: project visibility means "visible to everyone who can see the project".
   * Currently this is effectively global. If project-level ACLs are added in future,
   * this function must be updated to check project membership.
   */
  canAccessObservation(agentId: string, obs: {
    agent: string;
    department: string;
    visibility: 'private' | 'department' | 'project' | 'public';
  }): boolean {
    const agent = this.getAgent(agentId);
    if (!agent) return false;
    if (!this.hasPermission(agentId, 'read')) return false;

    switch (obs.visibility) {
      case 'public':
        return true;
      case 'project':
        // NOTE: Currently project = global. Future: check project membership.
        return true;
      case 'department':
        return agent.department === obs.department;
      case 'private':
        return agentId === obs.agent;
      default:
        return false;
    }
  }
}
```

```bash
git commit -m "feat: add AgentService with O(1) lookup and brute-force protection"
```

---

### Task 2.3: Add Authentication Middleware with Rate Limiting

**Files:**
- Create: `src/services/worker/http/middleware/auth.ts`
- Create: `src/services/worker/http/middleware/rate-limit.ts`

**Key additions:**
- O(1) key lookup (no table scan)
- Rate limiting per IP
- Handles locked agents gracefully

```typescript
// src/services/worker/http/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { AgentService, AgentLockedError } from '../../../agents/AgentService.js';
import { logger } from '../../../../utils/logger.js';

export interface AuthenticatedRequest extends Request {
  agent?: any;
  agentId?: string;
}

/**
 * Create authentication middleware with O(1) key lookup.
 */
export function createAuthMiddleware(agentService: AgentService) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing or invalid Authorization header'
      });
      return;
    }

    const apiKey = authHeader.slice(7);

    try {
      // O(1) lookup by key prefix
      const agent = agentService.findAgentByKey(apiKey);

      if (!agent) {
        logger.warn('AUTH', 'Invalid API key', { ip: req.ip });
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Invalid API key'
        });
        return;
      }

      if (!agent.verified) {
        res.status(403).json({
          error: 'FORBIDDEN',
          message: 'Agent not verified. Call /api/agents/verify first.'
        });
        return;
      }

      req.agent = agent;
      req.agentId = agent.id;
      next();

    } catch (error) {
      if (error instanceof AgentLockedError) {
        res.status(429).json({
          error: 'TOO_MANY_REQUESTS',
          message: error.message,
          retryAfter: Math.ceil((error as any).lockedUntil?.getTime() - Date.now()) / 1000
        });
        return;
      }
      throw error;
    }
  };
}
```

```typescript
// src/services/worker/http/middleware/rate-limit.ts
import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for authentication endpoints.
 * More strict than general API limits.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per window
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Too many authentication attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General API rate limiter.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Rate limit exceeded.'
  },
});
```

```bash
git commit -m "feat: add auth middleware with O(1) lookup and rate limiting"
```

---

### Task 2.4: Add Agent API Endpoints

Same as revision 2, but with rate limiting on /verify:

```typescript
// Apply rate limiting to auth endpoints
app.post('/api/agents/verify', authRateLimiter, this.handleVerify.bind(this));
```

---

### Task 2.5: Update Observation Insertion with Agent Metadata

Same as revision 2.

---

### Task 2.6: Enforce Visibility in Search and Context

Same as revision 2, with added comment about future project-level ACLs:

```typescript
// IMPORTANT: visibility = 'project' currently means "visible to everyone".
// If project-level ACLs are added, update this filter to check project membership.
```

---

## Phase 3: Integration & Testing

### Task 3.1-3.4: Same as revision 2

With updated documentation including security warnings.

---

## Phase 4: Polish & Maintenance (Optional)

These tasks are not blockers but improve operational readiness.

### Task 4.1: Handle Prefix Collisions

**Issue:** Two keys could theoretically share the same 12-char prefix (~1 in 2^48 chance).

**Solution:** Document acceptable risk OR add composite unique constraint.

```typescript
// Option A: Accept collision risk (current approach)
// In findAgentByKey, if prefix matches but hash doesn't, log warning
// Collision probability is ~1 in 2^48 for 12-char base64url prefix

// Option B: Add composite unique constraint in migration
db.run(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_key_composite
  ON agents(api_key_prefix, api_key_hash);
`);
```

**Recommendation:** Option A is fine for <10K agents. Add Option B if scale increases.

---

### Task 4.2: Add Maintenance CLI Commands

**Files:**
- Modify: `src/cli/commands/maintenance.ts`

```typescript
// src/cli/commands/maintenance.ts

/**
 * Run periodic maintenance tasks.
 * Recommended: weekly via cron or systemd timer.
 */
export async function runMaintenance(options: {
  aliasMaxAgeDays?: number;
  auditMaxAgeDays?: number;
  dryRun?: boolean;
}): Promise<void> {
  const db = openDatabase();

  const aliasAge = options.aliasMaxAgeDays ?? 365;
  const auditAge = options.auditMaxAgeDays ?? 90;

  if (options.dryRun) {
    const aliasCount = countOldAliases(db, aliasAge);
    const auditCount = countOldAuditLogs(db, auditAge);
    console.log(`[DRY RUN] Would delete ${aliasCount} aliases older than ${aliasAge} days`);
    console.log(`[DRY RUN] Would delete ${auditCount} audit logs older than ${auditAge} days`);
    return;
  }

  const aliasDeleted = cleanupOldAliases(db, aliasAge);
  const auditDeleted = cleanupOldAuditLogs(db, auditAge);

  console.log(`Deleted ${aliasDeleted} old aliases`);
  console.log(`Deleted ${auditDeleted} old audit logs`);
  db.close();
}

function countOldAliases(db: Database, days: number): number {
  const cutoff = Math.floor(Date.now() / 1000) - (days * 86400);
  const result = db.query(`
    SELECT COUNT(*) as count FROM project_aliases WHERE created_at_epoch < ?
  `).get(cutoff) as { count: number };
  return result.count;
}

function countOldAuditLogs(db: Database, days: number): number {
  const cutoff = Math.floor(Date.now() / 1000) - (days * 86400);
  const result = db.query(`
    SELECT COUNT(*) as count FROM audit_log WHERE created_at_epoch < ?
  `).get(cutoff) as { count: number };
  return result.count;
}

function cleanupOldAuditLogs(db: Database, days: number): number {
  const cutoff = Math.floor(Date.now() / 1000) - (days * 86400);
  const result = db.run(`
    DELETE FROM audit_log WHERE created_at_epoch < ?
  `, [cutoff]);
  return result.changes;
}
```

**CLI usage:**
```bash
# Dry run
npx claude-mem maintenance --dry-run

# Actual cleanup
npx claude-mem maintenance --alias-max-age=365 --audit-max-age=90
```

**Cron example:**
```bash
# Weekly maintenance (Sunday 3am)
0 3 * * 0 /usr/bin/npx claude-mem maintenance >> /var/log/claude-mem-maintenance.log 2>&1
```

---

### Task 4.3: Add Metrics Endpoint

**Files:**
- Create: `src/services/worker/http/routes/MetricsRoutes.ts`

```typescript
// src/services/worker/http/routes/MetricsRoutes.ts
import { Express, Request, Response } from 'express';
import { Database } from 'bun:sqlite';

export class MetricsRoutes {
  constructor(private db: Database) {}

  register(app: Express): void {
    app.get('/api/metrics', this.handleMetrics.bind(this));
  }

  private handleMetrics(_req: Request, res: Response): void {
    const metrics = this.collectMetrics();
    res.json(metrics);
  }

  private collectMetrics(): object {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;
    const oneHourAgo = now - 3600;

    // Agent metrics
    const totalAgents = this.count('SELECT COUNT(*) FROM agents');
    const verifiedAgents = this.count('SELECT COUNT(*) FROM agents WHERE verified = 1');
    const lockedAgents = this.count(
      'SELECT COUNT(*) FROM agents WHERE locked_until_epoch > ?', [now]
    );
    const activeAgents24h = this.count(
      'SELECT COUNT(*) FROM agents WHERE last_seen_at_epoch > ?', [oneDayAgo]
    );

    // Auth metrics
    const failedAttempts1h = this.count(
      "SELECT COUNT(*) FROM audit_log WHERE action = 'verify_failed' AND created_at_epoch > ?",
      [oneHourAgo]
    );
    const lockouts24h = this.count(
      "SELECT COUNT(*) FROM audit_log WHERE action = 'agent_locked' AND created_at_epoch > ?",
      [oneDayAgo]
    );

    // Alias metrics
    const totalAliases = this.count('SELECT COUNT(*) FROM project_aliases');
    const aliasStats = this.db.query(`
      SELECT
        COUNT(DISTINCT new_project) as projects_with_aliases,
        MAX(alias_count) as max_aliases_per_project,
        AVG(alias_count) as avg_aliases_per_project
      FROM (
        SELECT new_project, COUNT(*) as alias_count
        FROM project_aliases
        GROUP BY new_project
      )
    `).get() as any;

    // Observation metrics
    const totalObservations = this.count('SELECT COUNT(*) FROM observations');
    const observationsByVisibility = this.db.query(`
      SELECT visibility, COUNT(*) as count
      FROM observations
      GROUP BY visibility
    `).all();

    return {
      timestamp: new Date().toISOString(),
      agents: {
        total: totalAgents,
        verified: verifiedAgents,
        locked: lockedAgents,
        active_24h: activeAgents24h
      },
      auth: {
        failed_attempts_1h: failedAttempts1h,
        lockouts_24h: lockouts24h
      },
      aliases: {
        total: totalAliases,
        projects_with_aliases: aliasStats?.projects_with_aliases ?? 0,
        max_per_project: aliasStats?.max_aliases_per_project ?? 0,
        avg_per_project: Math.round((aliasStats?.avg_aliases_per_project ?? 0) * 10) / 10
      },
      observations: {
        total: totalObservations,
        by_visibility: observationsByVisibility
      }
    };
  }

  private count(sql: string, params: any[] = []): number {
    const result = this.db.query(sql).get(...params) as { 'COUNT(*)': number };
    return result['COUNT(*)'];
  }
}
```

**Example response:**
```json
{
  "timestamp": "2026-02-03T12:00:00Z",
  "agents": {
    "total": 15,
    "verified": 12,
    "locked": 1,
    "active_24h": 8
  },
  "auth": {
    "failed_attempts_1h": 3,
    "lockouts_24h": 1
  },
  "aliases": {
    "total": 42,
    "projects_with_aliases": 8,
    "max_per_project": 12,
    "avg_per_project": 5.2
  },
  "observations": {
    "total": 1523,
    "by_visibility": [
      {"visibility": "project", "count": 1200},
      {"visibility": "department", "count": 280},
      {"visibility": "private", "count": 43}
    ]
  }
}
```

---

### Task 4.4: Add Agent Self-Info Endpoint

**Files:**
- Modify: `src/services/worker/http/routes/AgentRoutes.ts`

```typescript
// Add to AgentRoutes.ts

register(app: Express): void {
  // ... existing routes

  // Protected: Get own agent info including key metadata
  app.get('/api/agents/me', authMiddleware, this.handleGetSelf.bind(this));
}

private handleGetSelf(req: AuthenticatedRequest, res: Response): void {
  const agent = req.agent;
  if (!agent) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  // Get last rotation from audit log
  const lastRotation = this.db.query(`
    SELECT created_at FROM audit_log
    WHERE agent_id = ? AND action IN ('key_rotated', 'agent_registered')
    ORDER BY created_at_epoch DESC
    LIMIT 1
  `).get(agent.id) as { created_at: string } | null;

  res.json({
    agent: {
      id: agent.id,
      department: agent.department,
      permissions: agent.permissions,
      verified: agent.verified,
      last_seen_at: agent.last_seen_at,
      key_expires_at: agent.expires_at,
      key_last_rotated: lastRotation?.created_at ?? agent.created_at,
      days_until_expiry: agent.expires_at_epoch
        ? Math.max(0, Math.ceil((agent.expires_at_epoch - Date.now() / 1000) / 86400))
        : null
    }
  });
}
```

**Example response:**
```json
{
  "agent": {
    "id": "seb@laptop",
    "department": "engineering",
    "permissions": "read,write",
    "verified": true,
    "last_seen_at": "2026-02-03T12:00:00Z",
    "key_expires_at": "2026-05-03T12:00:00Z",
    "key_last_rotated": "2026-02-01T10:30:00Z",
    "days_until_expiry": 89
  }
}
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1.1-1.7 | Git-based project ID, configurable remote preference, alias cleanup |
| 2 | 2.1-2.6 | Agents with O(1) key lookup, brute-force protection, rate limiting |
| 3 | 3.1-3.4 | E2E tests, settings, documentation with security warnings |
| 4 | 4.1-4.4 | **Optional:** Collision handling, maintenance CLI, metrics, self-info |

**Security Features (v3):**
- O(1) API key lookup via prefix index (no table scan)
- Brute-force protection: 5 attempts → 5 minute lockout
- Rate limiting: 20 auth attempts per 15 minutes per IP
- Key expiration: 90 days default (configurable)
- Explicit key revocation endpoint
- Audit logging for all auth events

**Performance:**
- Alias query hard cap: 100 (avoids SQLite 999 parameter limit)
- Key lookup: O(1) via prefix index instead of O(n) table scan

**Operational:**
- Maintenance CLI for periodic cleanup
- Metrics endpoint for monitoring
- Self-info endpoint for key expiry awareness

**Breaking Changes:** None.

**Total Tasks:** 21 (17 core + 4 polish)
