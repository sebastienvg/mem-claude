/**
 * Multi-Agent E2E Tests (Task 3.1)
 *
 * Tests the full workflow of multi-agent architecture:
 * - Agent lifecycle (register, verify, rotate, revoke)
 * - Visibility enforcement
 * - API integration
 *
 * Part of Phase 3: Integration & Testing (#14, #15)
 */

import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { AgentService, AgentLockedError } from '../../src/services/agents/AgentService.js';
import {
  storeObservation,
} from '../../src/services/sqlite/Observations.js';
import {
  createSDKSession,
  updateMemorySessionId,
} from '../../src/services/sqlite/Sessions.js';
import {
  registerProjectAlias,
  getProjectsWithAliases,
} from '../../src/services/sqlite/project-aliases.js';
import { logger } from '../../src/utils/logger.js';
import type { ObservationInput } from '../../src/services/sqlite/observations/types.js';
import type { Database } from 'bun:sqlite';

// Suppress logger output during tests
let loggerSpies: ReturnType<typeof spyOn>[] = [];

describe('Multi-Agent E2E', () => {
  let db: Database;
  let agentService: AgentService;

  beforeEach(() => {
    loggerSpies = [
      spyOn(logger, 'info').mockImplementation(() => {}),
      spyOn(logger, 'debug').mockImplementation(() => {}),
      spyOn(logger, 'warn').mockImplementation(() => {}),
      spyOn(logger, 'error').mockImplementation(() => {}),
    ];

    const claudeMemDb = new ClaudeMemDatabase(':memory:');
    db = claudeMemDb.db;
    agentService = new AgentService(db);
  });

  afterEach(() => {
    loggerSpies.forEach(spy => spy.mockRestore());
    db.close();
  });

  /**
   * Helper to create a valid observation input
   */
  function createObservationInput(overrides: Partial<ObservationInput> = {}): ObservationInput {
    return {
      type: 'discovery',
      title: 'Test Observation',
      subtitle: 'Test Subtitle',
      facts: ['fact1', 'fact2'],
      narrative: 'Test narrative content',
      concepts: ['test'],
      files_read: ['/path/to/file1.ts'],
      files_modified: ['/path/to/file2.ts'],
      ...overrides,
    };
  }

  /**
   * Helper to create a session and return memory_session_id
   */
  function createSessionWithMemoryId(
    contentSessionId: string,
    memorySessionId: string,
    project: string = 'github.com/test/repo'
  ): string {
    const sessionId = createSDKSession(db, contentSessionId, project, 'initial prompt');
    updateMemorySessionId(db, sessionId, memorySessionId);
    return memorySessionId;
  }

  describe('Agent Lifecycle', () => {
    it('should support full lifecycle: register -> verify -> use -> rotate -> revoke', () => {
      // 1. Register
      const regResult = agentService.registerAgent({
        id: 'lifecycle@test-host',
        department: 'engineering',
      });

      expect(regResult.agent).toBeTruthy();
      expect(regResult.apiKey).toMatch(/^cm_/);
      const originalKey = regResult.apiKey!;

      // 2. Verify
      const verified = agentService.verifyAgent('lifecycle@test-host', originalKey);
      expect(verified).toBe(true);

      const agent = agentService.getAgent('lifecycle@test-host');
      expect(agent?.verified).toBe(true);

      // 3. Use (check permissions)
      const hasRead = agentService.hasPermission('lifecycle@test-host', 'read');
      const hasWrite = agentService.hasPermission('lifecycle@test-host', 'write');
      expect(hasRead).toBe(true);
      expect(hasWrite).toBe(true);

      // 4. Rotate key
      const newKey = agentService.rotateApiKey('lifecycle@test-host');
      expect(newKey).toMatch(/^cm_/);
      expect(newKey).not.toBe(originalKey);

      // Old key no longer works
      const oldKeyAgent = agentService.findAgentByKey(originalKey);
      expect(oldKeyAgent).toBeNull();

      // Re-verify with new key
      const reVerified = agentService.verifyAgent('lifecycle@test-host', newKey!);
      expect(reVerified).toBe(true);

      // 5. Revoke
      const revoked = agentService.revokeApiKey('lifecycle@test-host');
      expect(revoked).toBe(true);

      // Key no longer works
      const revokedAgent = agentService.findAgentByKey(newKey!);
      expect(revokedAgent).toBeNull();
    });

    it('should handle key expiration (mocked)', () => {
      // Register agent
      const regResult = agentService.registerAgent({
        id: 'expiring@test-host',
        department: 'engineering',
      });
      const apiKey = regResult.apiKey!;

      // Manually set expiration to past
      const pastEpoch = Math.floor(Date.now() / 1000) - 86400; // 1 day ago
      db.run(`
        UPDATE agents SET expires_at_epoch = ? WHERE id = ?
      `, [pastEpoch, 'expiring@test-host']);

      // Key should not work
      const agent = agentService.findAgentByKey(apiKey);
      expect(agent).toBeNull();
    });

    it('should lock agent after 5 failed attempts', () => {
      // Register agent
      const regResult = agentService.registerAgent({
        id: 'lockout@test-host',
        department: 'engineering',
      });
      const correctKey = regResult.apiKey!;

      // Create a wrong key with the SAME PREFIX but different suffix
      // The key format is cm_<24 bytes base64url>, prefix is first 12 chars
      const prefix = correctKey.slice(0, 12);
      const wrongKey = prefix + 'WRONG_SUFFIX_HERE';

      // Attempt 5 times with wrong key (same prefix triggers the failed_attempts increment)
      for (let i = 0; i < 5; i++) {
        const agent = agentService.findAgentByKey(wrongKey);
        expect(agent).toBeNull();
      }

      // 6th attempt should throw AgentLockedError
      expect(() => {
        agentService.findAgentByKey(wrongKey);
      }).toThrow(AgentLockedError);

      // Even correct key should fail during lockout (same prefix = same agent)
      expect(() => {
        agentService.findAgentByKey(correctKey);
      }).toThrow(AgentLockedError);
    });
  });

  describe('Visibility Workflow', () => {
    let aliceKey: string;
    let bobKey: string;
    let carolKey: string;

    beforeEach(() => {
      // Register three agents
      const aliceReg = agentService.registerAgent({
        id: 'alice@test-host',
        department: 'engineering',
      });
      aliceKey = aliceReg.apiKey!;
      agentService.verifyAgent('alice@test-host', aliceKey);

      const bobReg = agentService.registerAgent({
        id: 'bob@test-host',
        department: 'engineering',
      });
      bobKey = bobReg.apiKey!;
      agentService.verifyAgent('bob@test-host', bobKey);

      const carolReg = agentService.registerAgent({
        id: 'carol@test-host',
        department: 'marketing',
      });
      carolKey = carolReg.apiKey!;
      agentService.verifyAgent('carol@test-host', carolKey);

      // Create test session
      createSessionWithMemoryId('vis-content', 'vis-mem-session');

      // Create observations with different visibility levels
      storeObservation(db, 'vis-mem-session', 'github.com/test/repo', createObservationInput({
        title: 'Private Note',
        narrative: 'Only Alice can see',
        agent: 'alice@test-host',
        department: 'engineering',
        visibility: 'private',
      }));

      storeObservation(db, 'vis-mem-session', 'github.com/test/repo', createObservationInput({
        title: 'Team Note',
        narrative: 'Engineering team can see',
        agent: 'alice@test-host',
        department: 'engineering',
        visibility: 'department',
      }));

      storeObservation(db, 'vis-mem-session', 'github.com/test/repo', createObservationInput({
        title: 'Project Note',
        narrative: 'Everyone in project can see',
        agent: 'alice@test-host',
        department: 'engineering',
        visibility: 'project',
      }));

      storeObservation(db, 'vis-mem-session', 'github.com/test/repo', createObservationInput({
        title: 'Public Note',
        narrative: 'Everyone can see',
        agent: 'alice@test-host',
        department: 'engineering',
        visibility: 'public',
      }));
    });

    /**
     * Query observations with visibility filtering
     */
    function queryWithVisibility(agentId?: string): any[] {
      const params: any[] = ['github.com/test/repo'];
      let sql = `SELECT title FROM observations WHERE project = ?`;

      if (agentId) {
        const agent = agentService.getAgent(agentId);
        if (agent) {
          sql += ` AND (
            visibility IN ('public', 'project')
            OR (visibility = 'department' AND department = ?)
            OR (visibility = 'private' AND agent = ?)
          )`;
          params.push(agent.department, agentId);
        } else {
          sql += ` AND visibility IN ('public', 'project')`;
        }
      } else {
        sql += ` AND visibility IN ('public', 'project')`;
      }

      return db.query(sql).all(...params) as any[];
    }

    it('should allow agent to see own private observation', () => {
      const results = queryWithVisibility('alice@test-host');
      const titles = results.map(r => r.title);

      expect(titles).toContain('Private Note');
      expect(titles).toContain('Team Note');
      expect(titles).toContain('Project Note');
      expect(titles).toContain('Public Note');
      expect(results).toHaveLength(4);
    });

    it('should not allow other agent to see private observation', () => {
      const results = queryWithVisibility('bob@test-host');
      const titles = results.map(r => r.title);

      expect(titles).not.toContain('Private Note');
      expect(titles).toContain('Team Note'); // Same department
      expect(titles).toContain('Project Note');
      expect(titles).toContain('Public Note');
      expect(results).toHaveLength(3);
    });

    it('should allow same-department agent to see department observation', () => {
      const results = queryWithVisibility('bob@test-host');
      const titles = results.map(r => r.title);

      expect(titles).toContain('Team Note');
    });

    it('should not allow different-department agent to see department observation', () => {
      const results = queryWithVisibility('carol@test-host');
      const titles = results.map(r => r.title);

      expect(titles).not.toContain('Private Note');
      expect(titles).not.toContain('Team Note'); // Different department
      expect(titles).toContain('Project Note');
      expect(titles).toContain('Public Note');
      expect(results).toHaveLength(2);
    });

    it('should show only project/public to legacy mode (no agent)', () => {
      const results = queryWithVisibility(undefined);
      const titles = results.map(r => r.title);

      expect(titles).not.toContain('Private Note');
      expect(titles).not.toContain('Team Note');
      expect(titles).toContain('Project Note');
      expect(titles).toContain('Public Note');
      expect(results).toHaveLength(2);
    });
  });

  describe('Combined: Project Identity + Multi-Agent', () => {
    it('should enforce visibility correctly with project aliases', () => {
      const oldProject = 'old-repo-name';
      const newProject = 'github.com/org/old-repo-name';

      // Register alias
      registerProjectAlias(db, oldProject, newProject);

      // Register agents
      const aliceReg = agentService.registerAgent({
        id: 'alice@combined',
        department: 'engineering',
      });
      agentService.verifyAgent('alice@combined', aliceReg.apiKey!);

      const bobReg = agentService.registerAgent({
        id: 'bob@combined',
        department: 'engineering',
      });
      agentService.verifyAgent('bob@combined', bobReg.apiKey!);

      // Create sessions for both project names
      createSessionWithMemoryId('old-session', 'old-mem', oldProject);
      createSessionWithMemoryId('new-session', 'new-mem', newProject);

      // Store observation under OLD project name with private visibility
      storeObservation(db, 'old-mem', oldProject, createObservationInput({
        title: 'Legacy Private',
        narrative: 'Private observation from old days',
        agent: 'alice@combined',
        department: 'engineering',
        visibility: 'private',
      }));

      // Store observation under NEW project name with department visibility
      storeObservation(db, 'new-mem', newProject, createObservationInput({
        title: 'New Team Note',
        narrative: 'Team observation with new ID',
        agent: 'alice@combined',
        department: 'engineering',
        visibility: 'department',
      }));

      // Query using new project ID - should find observations from both
      const projects = getProjectsWithAliases(db, newProject);
      const placeholders = projects.map(() => '?').join(', ');

      // Alice (owner) should see both
      const aliceParams = [...projects, 'engineering', 'alice@combined'];
      const aliceResults = db.query(`
        SELECT title FROM observations
        WHERE project IN (${placeholders})
        AND (
          visibility IN ('public', 'project')
          OR (visibility = 'department' AND department = ?)
          OR (visibility = 'private' AND agent = ?)
        )
      `).all(...aliceParams) as any[];

      expect(aliceResults.map(r => r.title)).toContain('Legacy Private');
      expect(aliceResults.map(r => r.title)).toContain('New Team Note');

      // Bob (same department) should see only department note
      const bobParams = [...projects, 'engineering', 'bob@combined'];
      const bobResults = db.query(`
        SELECT title FROM observations
        WHERE project IN (${placeholders})
        AND (
          visibility IN ('public', 'project')
          OR (visibility = 'department' AND department = ?)
          OR (visibility = 'private' AND agent = ?)
        )
      `).all(...bobParams) as any[];

      expect(bobResults.map(r => r.title)).not.toContain('Legacy Private');
      expect(bobResults.map(r => r.title)).toContain('New Team Note');
    });

    it('should create observation with git remote project ID and proper agent metadata', () => {
      // Simulate full flow
      const projectId = 'github.com/myorg/my-repo';

      // Register agent
      const agentReg = agentService.registerAgent({
        id: 'dev@machine',
        department: 'development',
      });
      agentService.verifyAgent('dev@machine', agentReg.apiKey!);

      // Create session
      const memSessionId = createSessionWithMemoryId('full-flow', 'full-mem', projectId);

      // Store observation with full metadata
      storeObservation(db, memSessionId, projectId, {
        type: 'feature',
        title: 'Agent-Aware Feature',
        subtitle: 'Feature with proper attribution',
        facts: ['Implemented by dev@machine'],
        narrative: 'Complete feature implementation',
        concepts: ['multi-agent', 'visibility'],
        files_read: ['/src/feature.ts'],
        files_modified: ['/src/feature.ts'],
        agent: 'dev@machine',
        department: 'development',
        visibility: 'project',
      });

      // Verify stored correctly
      const obs = db.query(`
        SELECT * FROM observations WHERE title = 'Agent-Aware Feature'
      `).get() as any;

      expect(obs).toBeTruthy();
      expect(obs.project).toBe(projectId);
      expect(obs.agent).toBe('dev@machine');
      expect(obs.department).toBe('development');
      expect(obs.visibility).toBe('project');
    });
  });

  describe('API Integration Patterns', () => {
    it('should support protected endpoint pattern', () => {
      // Register and verify
      const regResult = agentService.registerAgent({
        id: 'api@test',
        department: 'engineering',
      });
      const apiKey = regResult.apiKey!;

      // Simulate auth middleware check
      const authenticatedAgent = agentService.findAgentByKey(apiKey);
      expect(authenticatedAgent).toBeTruthy();
      expect(authenticatedAgent?.id).toBe('api@test');

      // After verification
      agentService.verifyAgent('api@test', apiKey);
      const verifiedAgent = agentService.getAgent('api@test');
      expect(verifiedAgent?.verified).toBe(true);
    });

    it('should reject invalid API keys', () => {
      const invalidKey = 'cm_invalid_key_that_does_not_exist';
      const agent = agentService.findAgentByKey(invalidKey);
      expect(agent).toBeNull();
    });

    it('should reject requests with revoked keys', () => {
      // Register and get key
      const regResult = agentService.registerAgent({
        id: 'revoked@test',
        department: 'engineering',
      });
      const apiKey = regResult.apiKey!;

      // Verify it works
      let agent = agentService.findAgentByKey(apiKey);
      expect(agent).toBeTruthy();

      // Revoke
      agentService.revokeApiKey('revoked@test');

      // Should no longer work
      agent = agentService.findAgentByKey(apiKey);
      expect(agent).toBeNull();
    });
  });
});
