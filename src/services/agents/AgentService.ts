/**
 * AgentService - Multi-Agent Authentication and Authorization
 *
 * Manages agent registration, API key generation, O(1) key lookup,
 * brute-force protection, and visibility-based access control.
 *
 * Part of Phase 2: Multi-Agent Architecture (#15)
 */

import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'crypto';
import { logger } from '../../utils/logger.js';
import { AgentIdFormatError, AgentLockedError } from './errors.js';
import {
  getAgentKeyExpiryDays,
  getLockoutDuration,
  getMaxFailedAttempts,
} from '../../shared/settings-helpers.js';

// Re-export error classes for convenient imports
export { AgentIdFormatError, AgentLockedError };

// Constants
const AGENT_ID_PATTERN = /^[\w.-]+@[\w.-]+$/;
const KEY_PREFIX_LENGTH = 12;

/**
 * Agent record from the database
 */
export interface Agent {
  id: string;
  department: string;
  permissions: string;
  verified: boolean;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string | null;
  expires_at_epoch: number | null;
  spawned_by?: string | null;
  bead_id?: string | null;
  role?: string | null;
}

/**
 * Result of agent registration
 */
export interface RegisterResult {
  agent: Agent;
  apiKey?: string;
}

/**
 * Visibility levels for observations and summaries
 */
export type Visibility = 'private' | 'department' | 'project' | 'public';

/**
 * Observation access check input
 */
export interface ObservationAccessCheck {
  agent: string;
  department: string;
  visibility: Visibility;
}

/**
 * Agent registration input
 */
export interface RegisterAgentInput {
  id: string;
  department: string;
  permissions?: string;
  spawned_by?: string;
  bead_id?: string;
  role?: string;
}

/**
 * AgentService manages agent authentication and authorization
 */
export class AgentService {
  constructor(private db: Database) {}

  /**
   * Validate agent ID format (user@host pattern)
   * Also rejects SQL injection attempts
   */
  private validateAgentId(id: string): void {
    if (!AGENT_ID_PATTERN.test(id)) {
      throw new AgentIdFormatError(id);
    }
    // Reject SQL injection attempts
    if (id.includes(';') || id.includes('--') || id.includes("'")) {
      throw new AgentIdFormatError(id);
    }
  }

  /**
   * Generate a new API key with cm_ prefix
   * Format: cm_<24 random bytes as base64url>
   */
  private generateApiKey(): string {
    const bytes = randomBytes(24);
    return `cm_${bytes.toString('base64url')}`;
  }

  /**
   * Extract the prefix for O(1) lookup
   */
  private getKeyPrefix(apiKey: string): string {
    return apiKey.slice(0, KEY_PREFIX_LENGTH);
  }

  /**
   * Hash the API key with SHA-256
   * Format: sha256:<hex_digest>
   */
  private hashApiKey(apiKey: string): string {
    return `sha256:${createHash('sha256').update(apiKey).digest('hex')}`;
  }

  /**
   * Write an audit log entry
   */
  private audit(agentId: string, action: string, details?: object, ip?: string): void {
    try {
      this.db.run(
        `
        INSERT INTO audit_log (agent_id, action, details, ip_address)
        VALUES (?, ?, ?, ?)
      `,
        [agentId, action, details ? JSON.stringify(details) : null, ip ?? null]
      );
    } catch (error) {
      logger.warn('DB', 'Failed to write audit log', { agentId, action, error });
    }
  }

  /**
   * Register a new agent or update an existing one
   *
   * - New agents receive an API key with 90-day expiration
   * - Existing agents just update last_seen_at (no new key)
   */
  registerAgent(reg: RegisterAgentInput): RegisterResult {
    this.validateAgentId(reg.id);

    const existing = this.getAgent(reg.id);
    const now = new Date().toISOString();
    const nowEpoch = Math.floor(Date.now() / 1000);

    if (existing) {
      // Update last_seen_at and lineage fields for existing agent
      const updates = ['last_seen_at = ?', 'last_seen_at_epoch = ?'];
      const params: any[] = [now, nowEpoch];

      if (reg.spawned_by !== undefined) {
        updates.push('spawned_by = ?');
        params.push(reg.spawned_by);
      }
      if (reg.bead_id !== undefined) {
        updates.push('bead_id = ?');
        params.push(reg.bead_id);
      }
      if (reg.role !== undefined) {
        updates.push('role = ?');
        params.push(reg.role);
      }

      params.push(reg.id);
      this.db.run(
        `UPDATE agents SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
      this.audit(reg.id, 'agent_seen');
      return { agent: this.getAgent(reg.id)! };
    }

    // New agent - generate key with expiration
    const apiKey = this.generateApiKey();
    const prefix = this.getKeyPrefix(apiKey);
    const hash = this.hashApiKey(apiKey);
    const expiryDays = getAgentKeyExpiryDays();
    const expiresEpoch = nowEpoch + expiryDays * 86400;
    const expiresAt = new Date(expiresEpoch * 1000).toISOString();

    this.db.run(
      `
      INSERT INTO agents (
        id, department, permissions, api_key_prefix, api_key_hash,
        last_seen_at, last_seen_at_epoch, expires_at, expires_at_epoch,
        spawned_by, bead_id, role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        reg.id,
        reg.department,
        reg.permissions ?? 'read,write',
        prefix,
        hash,
        now,
        nowEpoch,
        expiresAt,
        expiresEpoch,
        reg.spawned_by ?? null,
        reg.bead_id ?? null,
        reg.role ?? null,
      ]
    );

    this.audit(reg.id, 'agent_registered', { department: reg.department });
    logger.info('DB', 'Registered new agent', { id: reg.id, expiresAt });

    return { agent: this.getAgent(reg.id)!, apiKey };
  }

  /**
   * Get an agent by ID
   * Returns null if agent doesn't exist
   */
  getAgent(id: string): Agent | null {
    const row = this.db.query('SELECT * FROM agents WHERE id = ?').get(id) as any;
    if (!row) return null;
    return { ...row, verified: Boolean(row.verified) };
  }

  /**
   * Find an agent by API key using O(1) prefix lookup
   *
   * Security features:
   * - Checks lockout before verification
   * - Increments failed_attempts on mismatch
   * - Locks agent after MAX_FAILED_ATTEMPTS
   * - Resets failed_attempts on success
   * - Checks key expiration
   *
   * @throws AgentLockedError if agent is locked
   */
  findAgentByKey(apiKey: string): Agent | null {
    const prefix = this.getKeyPrefix(apiKey);
    const hash = this.hashApiKey(apiKey);

    // O(1) lookup by prefix
    const candidate = this.db
      .query(
        `
      SELECT * FROM agents WHERE api_key_prefix = ?
    `
      )
      .get(prefix) as any;

    if (!candidate) return null;

    // Check lockout first
    const now = Math.floor(Date.now() / 1000);
    if (candidate.locked_until_epoch && candidate.locked_until_epoch > now) {
      throw new AgentLockedError(candidate.id, new Date(candidate.locked_until_epoch * 1000));
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
        this.db.run(
          `
          UPDATE agents SET failed_attempts = 0 WHERE id = ?
        `,
          [candidate.id]
        );
      }

      return { ...candidate, verified: Boolean(candidate.verified) };
    }

    // Prefix matched but hash didn't - log warning for potential collision detection
    // This is either a wrong key or a very rare prefix collision (~1 in 2^48 probability)
    logger.warn('DB', 'API key prefix match but hash mismatch', {
      candidateId: candidate.id,
      note: 'Could be wrong key or rare prefix collision (~1 in 2^48 probability)',
    });

    // Failed attempt - increment counter
    const newAttempts = (candidate.failed_attempts || 0) + 1;
    let lockedUntil: number | null = null;

    const maxAttempts = getMaxFailedAttempts();
    if (newAttempts >= maxAttempts) {
      const lockoutDuration = getLockoutDuration();
      lockedUntil = now + lockoutDuration;
      this.audit(candidate.id, 'agent_locked', { attempts: newAttempts });
      logger.warn('DB', 'Agent locked due to failed attempts', {
        id: candidate.id,
        attempts: newAttempts,
      });
    }

    this.db.run(
      `
      UPDATE agents SET failed_attempts = ?, locked_until_epoch = ?
      WHERE id = ?
    `,
      [newAttempts, lockedUntil, candidate.id]
    );

    this.audit(candidate.id, 'verify_failed', { attempts: newAttempts });
    return null;
  }

  /**
   * Verify an agent's API key and set verified flag
   * Returns true if verification succeeded
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
   * Rotate an agent's API key
   *
   * - Generates new key
   * - Updates prefix and hash
   * - Resets verified flag
   * - Sets new expiration
   *
   * Returns the new API key, or null if agent doesn't exist
   */
  rotateApiKey(id: string, expiryDays?: number): string | null {
    const effectiveExpiryDays = expiryDays ?? getAgentKeyExpiryDays();
    const agent = this.getAgent(id);
    if (!agent) return null;

    const newKey = this.generateApiKey();
    const prefix = this.getKeyPrefix(newKey);
    const hash = this.hashApiKey(newKey);
    const now = Math.floor(Date.now() / 1000);
    const expiresEpoch = now + effectiveExpiryDays * 86400;
    const expiresAt = new Date(expiresEpoch * 1000).toISOString();

    this.db.run(
      `
      UPDATE agents SET
        api_key_prefix = ?, api_key_hash = ?, verified = 0,
        expires_at = ?, expires_at_epoch = ?, failed_attempts = 0
      WHERE id = ?
    `,
      [prefix, hash, expiresAt, expiresEpoch, id]
    );

    this.audit(id, 'key_rotated', { expiresAt });
    return newKey;
  }

  /**
   * Revoke an agent's API key
   *
   * - Sets prefix and hash to NULL
   * - Resets verified flag
   *
   * Returns true on success, false if agent doesn't exist
   */
  revokeApiKey(id: string): boolean {
    const agent = this.getAgent(id);
    if (!agent) return false;

    this.db.run(
      `
      UPDATE agents SET
        api_key_prefix = NULL, api_key_hash = NULL, verified = 0
      WHERE id = ?
    `,
      [id]
    );

    this.audit(id, 'key_revoked');
    logger.info('DB', 'Revoked API key', { id });
    return true;
  }

  /**
   * Check if an agent has a specific permission
   * Permissions are stored as comma-separated values
   */
  hasPermission(agentId: string, permission: 'read' | 'write'): boolean {
    const agent = this.getAgent(agentId);
    if (!agent) return false;
    return agent.permissions.split(',').includes(permission);
  }

  /**
   * Check if an agent can access an observation based on visibility rules
   *
   * Visibility levels:
   * - public: Anyone can access
   * - project: All agents in the project (currently global)
   * - department: Same department only
   * - private: Owner only
   */
  canAccessObservation(agentId: string, obs: ObservationAccessCheck): boolean {
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
