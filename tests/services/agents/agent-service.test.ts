/**
 * AgentService Tests
 * Tests agent registration, API key management, and access control
 *
 * Following TDD: These tests are written before the implementation.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { ClaudeMemDatabase } from '../../../src/services/sqlite/Database.js';
import {
  AgentService,
  AgentIdFormatError,
  AgentLockedError,
} from '../../../src/services/agents/AgentService.js';
import { logger } from '../../../src/utils/logger.js';
import type { Database } from 'bun:sqlite';
import type { Mock } from 'bun:test';

describe('AgentService', () => {
  let db: Database;
  let service: AgentService;
  let loggerSpies: Mock<any>[];

  beforeEach(() => {
    // Spy on logger to suppress output and capture calls
    loggerSpies = [
      spyOn(logger, 'info').mockImplementation(() => {}),
      spyOn(logger, 'debug').mockImplementation(() => {}),
      spyOn(logger, 'warn').mockImplementation(() => {}),
      spyOn(logger, 'error').mockImplementation(() => {}),
    ];

    db = new ClaudeMemDatabase(':memory:').db;
    service = new AgentService(db);
  });

  afterEach(() => {
    db.close();
    // Restore all spies
    loggerSpies.forEach(spy => spy.mockRestore());
  });

  describe('registerAgent', () => {
    it('should create new agent with API key', () => {
      const result = service.registerAgent({
        id: 'user@host',
        department: 'engineering',
      });

      expect(result.agent).toBeTruthy();
      expect(result.agent.id).toBe('user@host');
      expect(result.agent.department).toBe('engineering');
      expect(result.apiKey).toBeTruthy();
      expect(result.apiKey).toMatch(/^cm_/);
    });

    it('should update existing agent without new key', () => {
      service.registerAgent({ id: 'user@host', department: 'eng' });
      const result = service.registerAgent({ id: 'user@host', department: 'eng' });

      expect(result.agent).toBeTruthy();
      expect(result.apiKey).toBeUndefined();
    });

    it('should reject invalid ID format (missing @)', () => {
      expect(() => {
        service.registerAgent({ id: 'invalid-no-at', department: 'eng' });
      }).toThrow(AgentIdFormatError);
    });

    it('should reject SQL injection attempts with semicolon', () => {
      expect(() => {
        service.registerAgent({
          id: "user'; DROP TABLE agents;--@host",
          department: 'eng',
        });
      }).toThrow(AgentIdFormatError);
    });

    it('should reject SQL injection attempts with quotes', () => {
      expect(() => {
        service.registerAgent({
          id: "user'@host",
          department: 'eng',
        });
      }).toThrow(AgentIdFormatError);
    });

    it('should set default permissions to read,write', () => {
      const result = service.registerAgent({
        id: 'user@host',
        department: 'eng',
      });

      expect(result.agent.permissions).toBe('read,write');
    });

    it('should accept custom permissions', () => {
      const result = service.registerAgent({
        id: 'readonly@host',
        department: 'eng',
        permissions: 'read',
      });

      expect(result.agent.permissions).toBe('read');
    });
  });

  describe('getAgent', () => {
    it('should return agent by ID', () => {
      service.registerAgent({ id: 'test@host', department: 'eng' });

      const agent = service.getAgent('test@host');

      expect(agent).toBeTruthy();
      expect(agent!.id).toBe('test@host');
    });

    it('should return null for non-existent agent', () => {
      const agent = service.getAgent('nonexistent@host');

      expect(agent).toBeNull();
    });

    it('should convert verified to boolean', () => {
      service.registerAgent({ id: 'test@host', department: 'eng' });

      const agent = service.getAgent('test@host');

      expect(typeof agent!.verified).toBe('boolean');
      expect(agent!.verified).toBe(false);
    });
  });

  describe('findAgentByKey', () => {
    let apiKey: string;

    beforeEach(() => {
      const result = service.registerAgent({ id: 'test@host', department: 'eng' });
      apiKey = result.apiKey!;
    });

    it('should find agent by valid key (O(1) lookup)', () => {
      const agent = service.findAgentByKey(apiKey);

      expect(agent).toBeTruthy();
      expect(agent!.id).toBe('test@host');
    });

    it('should return null for invalid key', () => {
      const agent = service.findAgentByKey('cm_invalidkey123456789012345678');

      expect(agent).toBeNull();
    });

    it('should return null for expired key', () => {
      // Set expiration to past
      db.run(
        `
        UPDATE agents SET expires_at_epoch = ?
        WHERE id = 'test@host'
      `,
        [Math.floor(Date.now() / 1000) - 1000]
      );

      const agent = service.findAgentByKey(apiKey);
      expect(agent).toBeNull();
    });

    it('should throw AgentLockedError for locked agent', () => {
      // Lock the agent manually
      db.run(
        `
        UPDATE agents SET locked_until_epoch = ?
        WHERE id = 'test@host'
      `,
        [Math.floor(Date.now() / 1000) + 300]
      );

      expect(() => {
        service.findAgentByKey(apiKey);
      }).toThrow(AgentLockedError);
    });

    it('should increment failed_attempts on hash mismatch', () => {
      // Get the prefix from the real key
      const prefix = apiKey.slice(0, 12);

      // Create a fake key with same prefix but different suffix
      const fakeKey = prefix + 'x'.repeat(apiKey.length - 12);

      // This should return null (wrong key) and increment failed_attempts
      service.findAgentByKey(fakeKey);

      const agent = db
        .query('SELECT failed_attempts FROM agents WHERE id = ?')
        .get('test@host') as any;
      expect(agent.failed_attempts).toBe(1);
    });

    it('should lock agent after 5 failed attempts with same prefix', () => {
      const prefix = apiKey.slice(0, 12);
      const fakeKey = prefix + 'x'.repeat(apiKey.length - 12);

      // Simulate 5 failed attempts
      for (let i = 0; i < 5; i++) {
        service.findAgentByKey(fakeKey);
      }

      // Now the agent should be locked
      expect(() => {
        service.findAgentByKey(apiKey);
      }).toThrow(AgentLockedError);
    });

    it('should reset failed_attempts on successful verification', () => {
      const prefix = apiKey.slice(0, 12);
      const fakeKey = prefix + 'x'.repeat(apiKey.length - 12);

      // Simulate 3 failed attempts
      for (let i = 0; i < 3; i++) {
        service.findAgentByKey(fakeKey);
      }

      // Check failed_attempts is 3
      let agent = db
        .query('SELECT failed_attempts FROM agents WHERE id = ?')
        .get('test@host') as any;
      expect(agent.failed_attempts).toBe(3);

      // Successful verification should reset
      service.findAgentByKey(apiKey);

      agent = db
        .query('SELECT failed_attempts FROM agents WHERE id = ?')
        .get('test@host') as any;
      expect(agent.failed_attempts).toBe(0);
    });

    it('should log warning on prefix match with hash mismatch (prefix collision detection)', () => {
      // Get the prefix from the real key
      const prefix = apiKey.slice(0, 12);

      // Create a fake key with same prefix but different suffix (simulates potential collision)
      const fakeKey = prefix + 'x'.repeat(apiKey.length - 12);

      // This should trigger the prefix collision warning
      service.findAgentByKey(fakeKey);

      // Verify logger.warn was called with prefix collision warning
      const warnSpy = loggerSpies[2]; // warn is the 3rd spy
      expect(warnSpy).toHaveBeenCalled();

      // Check that the warning includes the relevant context
      const warnCalls = warnSpy.mock.calls;
      const prefixCollisionCall = warnCalls.find(
        (call: any[]) =>
          call[0] === 'DB' &&
          call[1]?.includes('prefix') &&
          call[1]?.includes('hash')
      );
      expect(prefixCollisionCall).toBeTruthy();
    });

    it('should still create audit log entry after prefix collision warning', () => {
      const prefix = apiKey.slice(0, 12);
      const fakeKey = prefix + 'x'.repeat(apiKey.length - 12);

      // Trigger the prefix collision scenario
      service.findAgentByKey(fakeKey);

      // Verify audit log was still created
      const audit = db
        .query("SELECT * FROM audit_log WHERE action = 'verify_failed'")
        .get() as any;
      expect(audit).toBeTruthy();
      expect(audit.agent_id).toBe('test@host');
    });
  });

  describe('verifyAgent', () => {
    let apiKey: string;

    beforeEach(() => {
      const result = service.registerAgent({ id: 'test@host', department: 'eng' });
      apiKey = result.apiKey!;
    });

    it('should set verified flag on success', () => {
      const success = service.verifyAgent('test@host', apiKey);

      expect(success).toBe(true);

      const agent = service.getAgent('test@host');
      expect(agent!.verified).toBe(true);
    });

    it('should return false for wrong key', () => {
      const success = service.verifyAgent('test@host', 'cm_wrongkey123456789012345678');

      expect(success).toBe(false);
    });

    it('should return false for wrong agent ID', () => {
      const success = service.verifyAgent('other@host', apiKey);

      expect(success).toBe(false);
    });

    it('should create audit log entry on success', () => {
      service.verifyAgent('test@host', apiKey);

      const audit = db
        .query("SELECT * FROM audit_log WHERE action = 'verify_success'")
        .get() as any;
      expect(audit).toBeTruthy();
      expect(audit.agent_id).toBe('test@host');
    });
  });

  describe('rotateApiKey', () => {
    let originalKey: string;

    beforeEach(() => {
      const result = service.registerAgent({ id: 'test@host', department: 'eng' });
      originalKey = result.apiKey!;
      service.verifyAgent('test@host', originalKey);
    });

    it('should generate new key', () => {
      const newKey = service.rotateApiKey('test@host');

      expect(newKey).toBeTruthy();
      expect(newKey).not.toBe(originalKey);
      expect(newKey).toMatch(/^cm_/);
    });

    it('should invalidate old key', () => {
      service.rotateApiKey('test@host');

      const agent = service.findAgentByKey(originalKey);
      expect(agent).toBeNull();
    });

    it('should reset verified flag', () => {
      service.rotateApiKey('test@host');

      const agent = service.getAgent('test@host');
      expect(agent!.verified).toBe(false);
    });

    it('should return null for non-existent agent', () => {
      const result = service.rotateApiKey('nonexistent@host');

      expect(result).toBeNull();
    });

    it('should accept custom expiry days', () => {
      const newKey = service.rotateApiKey('test@host', 30);

      expect(newKey).toBeTruthy();

      const agent = db.query('SELECT expires_at_epoch FROM agents WHERE id = ?').get('test@host') as any;
      const now = Math.floor(Date.now() / 1000);
      const expectedExpiry = now + 30 * 86400;

      // Allow 1 second tolerance
      expect(agent.expires_at_epoch).toBeGreaterThanOrEqual(expectedExpiry - 1);
      expect(agent.expires_at_epoch).toBeLessThanOrEqual(expectedExpiry + 1);
    });

    it('should create audit log entry', () => {
      service.rotateApiKey('test@host');

      const audit = db
        .query("SELECT * FROM audit_log WHERE action = 'key_rotated'")
        .get() as any;
      expect(audit).toBeTruthy();
      expect(audit.agent_id).toBe('test@host');
    });
  });

  describe('revokeApiKey', () => {
    let apiKey: string;

    beforeEach(() => {
      const result = service.registerAgent({ id: 'test@host', department: 'eng' });
      apiKey = result.apiKey!;
    });

    it('should revoke key successfully', () => {
      const success = service.revokeApiKey('test@host');

      expect(success).toBe(true);

      const agent = service.findAgentByKey(apiKey);
      expect(agent).toBeNull();
    });

    it('should return false for non-existent agent', () => {
      const success = service.revokeApiKey('nonexistent@host');

      expect(success).toBe(false);
    });

    it('should reset verified flag', () => {
      service.verifyAgent('test@host', apiKey);
      service.revokeApiKey('test@host');

      const agent = service.getAgent('test@host');
      expect(agent!.verified).toBe(false);
    });

    it('should create audit log entry', () => {
      service.revokeApiKey('test@host');

      const audit = db
        .query("SELECT * FROM audit_log WHERE action = 'key_revoked'")
        .get() as any;
      expect(audit).toBeTruthy();
      expect(audit.agent_id).toBe('test@host');
    });
  });

  describe('hasPermission', () => {
    it('should return true for granted permission', () => {
      service.registerAgent({
        id: 'test@host',
        department: 'eng',
        permissions: 'read,write',
      });

      expect(service.hasPermission('test@host', 'read')).toBe(true);
      expect(service.hasPermission('test@host', 'write')).toBe(true);
    });

    it('should return false for non-granted permission', () => {
      service.registerAgent({
        id: 'readonly@host',
        department: 'eng',
        permissions: 'read',
      });

      expect(service.hasPermission('readonly@host', 'read')).toBe(true);
      expect(service.hasPermission('readonly@host', 'write')).toBe(false);
    });

    it('should return false for non-existent agent', () => {
      expect(service.hasPermission('nonexistent@host', 'read')).toBe(false);
    });
  });

  describe('canAccessObservation', () => {
    beforeEach(() => {
      service.registerAgent({ id: 'agent1@host', department: 'eng' });
      service.registerAgent({ id: 'agent2@host', department: 'eng' });
      service.registerAgent({ id: 'agent3@host', department: 'ops' });
    });

    it('should allow public visibility to anyone', () => {
      const obs = {
        agent: 'agent1@host',
        department: 'eng',
        visibility: 'public' as const,
      };

      expect(service.canAccessObservation('agent2@host', obs)).toBe(true);
      expect(service.canAccessObservation('agent3@host', obs)).toBe(true);
    });

    it('should allow project visibility to anyone (currently global)', () => {
      const obs = {
        agent: 'agent1@host',
        department: 'eng',
        visibility: 'project' as const,
      };

      expect(service.canAccessObservation('agent2@host', obs)).toBe(true);
      expect(service.canAccessObservation('agent3@host', obs)).toBe(true);
    });

    it('should restrict department visibility to same department', () => {
      const obs = {
        agent: 'agent1@host',
        department: 'eng',
        visibility: 'department' as const,
      };

      expect(service.canAccessObservation('agent2@host', obs)).toBe(true); // Same dept
      expect(service.canAccessObservation('agent3@host', obs)).toBe(false); // Different dept
    });

    it('should restrict private visibility to owner only', () => {
      const obs = {
        agent: 'agent1@host',
        department: 'eng',
        visibility: 'private' as const,
      };

      expect(service.canAccessObservation('agent1@host', obs)).toBe(true); // Owner
      expect(service.canAccessObservation('agent2@host', obs)).toBe(false); // Not owner
    });

    it('should return false for non-existent agent', () => {
      const obs = {
        agent: 'agent1@host',
        department: 'eng',
        visibility: 'public' as const,
      };

      expect(service.canAccessObservation('nonexistent@host', obs)).toBe(false);
    });

    it('should return false if agent lacks read permission', () => {
      service.registerAgent({
        id: 'noread@host',
        department: 'eng',
        permissions: 'write', // No read permission
      });

      const obs = {
        agent: 'agent1@host',
        department: 'eng',
        visibility: 'public' as const,
      };

      expect(service.canAccessObservation('noread@host', obs)).toBe(false);
    });
  });
});
