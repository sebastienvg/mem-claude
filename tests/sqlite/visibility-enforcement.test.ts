/**
 * Visibility Enforcement Tests (Task 2.6)
 * Tests that search queries properly filter observations based on visibility rules
 *
 * Tests:
 * - Agent sees own private observations
 * - Agent cannot see other's private observations
 * - Agent sees department observations (same dept)
 * - Agent cannot see department observations (different dept)
 * - Agent sees project/public observations
 * - Legacy mode (no agent) sees project/public only
 * - Unknown agent sees project/public only
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { AgentService } from '../../src/services/agents/AgentService.js';
import {
  storeObservation,
} from '../../src/services/sqlite/Observations.js';
import {
  createSDKSession,
  updateMemorySessionId,
} from '../../src/services/sqlite/Sessions.js';
import type { ObservationInput } from '../../src/services/sqlite/observations/types.js';
import type { Database } from 'bun:sqlite';

describe('Visibility Enforcement', () => {
  let db: Database;
  let agentService: AgentService;

  beforeEach(() => {
    const claudeMemDb = new ClaudeMemDatabase(':memory:');
    db = claudeMemDb.db;
    agentService = new AgentService(db);

    // Create test agents in different departments
    agentService.registerAgent({ id: 'alice@host', department: 'engineering' });
    agentService.registerAgent({ id: 'bob@host', department: 'engineering' });
    agentService.registerAgent({ id: 'carol@host', department: 'marketing' });

    // Create a session for observations
    const memorySessionId = createSessionWithMemoryId('content-vis-test', 'mem-session-vis-test');

    // Create test observations with different visibility levels
    storeObservation(db, memorySessionId, 'github.com/test/repo', createObservationInput({
      title: 'Private to Alice',
      narrative: 'Only Alice can see this',
      agent: 'alice@host',
      department: 'engineering',
      visibility: 'private',
    }));

    storeObservation(db, memorySessionId, 'github.com/test/repo', createObservationInput({
      title: 'Engineering Dept',
      narrative: 'Engineering team can see this',
      agent: 'alice@host',
      department: 'engineering',
      visibility: 'department',
    }));

    storeObservation(db, memorySessionId, 'github.com/test/repo', createObservationInput({
      title: 'Project Wide',
      narrative: 'Everyone in project can see',
      agent: 'alice@host',
      department: 'engineering',
      visibility: 'project',
    }));

    storeObservation(db, memorySessionId, 'github.com/test/repo', createObservationInput({
      title: 'Public Info',
      narrative: 'Everyone can see this',
      agent: 'alice@host',
      department: 'engineering',
      visibility: 'public',
    }));
  });

  afterEach(() => {
    db.close();
  });

  // Helper to create a valid observation input
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

  // Helper to create a session and return memory_session_id for FK constraints
  function createSessionWithMemoryId(
    contentSessionId: string,
    memorySessionId: string,
    project: string = 'github.com/test/repo'
  ): string {
    const sessionId = createSDKSession(db, contentSessionId, project, 'initial prompt');
    updateMemorySessionId(db, sessionId, memorySessionId);
    return memorySessionId;
  }

  /**
   * Search observations with visibility filtering using direct SQL
   * This mimics what SessionSearch.searchObservations does with visibility options
   */
  function searchObservationsWithVisibility(options: {
    project: string;
    agentId?: string;
    agentService?: AgentService;
    limit?: number;
  }): any[] {
    const { project, agentId, agentService: svc, limit = 50 } = options;
    const params: any[] = [];

    let sql = `
      SELECT *
      FROM observations o
      WHERE o.project = ?
    `;
    params.push(project);

    // Add visibility filter
    if (agentId && svc) {
      const agent = svc.getAgent(agentId);
      if (agent) {
        // SQL-level filtering for performance
        // - public and project: everyone can see
        // - department: same department only
        // - private: owner only
        sql += ` AND (
          o.visibility IN ('public', 'project')
          OR (o.visibility = 'department' AND o.department = ?)
          OR (o.visibility = 'private' AND o.agent = ?)
        )`;
        params.push(agent.department, agentId);
      } else {
        // Unknown agent - public/project only
        sql += ` AND o.visibility IN ('public', 'project')`;
      }
    } else {
      // Legacy mode - public/project only
      // IMPORTANT: visibility = 'project' currently means "visible to everyone".
      // If project-level ACLs are added, update this filter.
      sql += ` AND o.visibility IN ('public', 'project')`;
    }

    sql += ` ORDER BY o.created_at_epoch DESC LIMIT ?`;
    params.push(limit);

    return db.query(sql).all(...params) as any[];
  }

  describe('Alice (engineering, owner)', () => {
    it('should see all observations including her own private', () => {
      const results = searchObservationsWithVisibility({
        project: 'github.com/test/repo',
        agentId: 'alice@host',
        agentService,
      });

      const titles = results.map(r => r.title);
      expect(titles).toContain('Private to Alice');
      expect(titles).toContain('Engineering Dept');
      expect(titles).toContain('Project Wide');
      expect(titles).toContain('Public Info');
      expect(results.length).toBe(4);
    });
  });

  describe('Bob (engineering, not owner)', () => {
    it('should see department and project/public, not private', () => {
      const results = searchObservationsWithVisibility({
        project: 'github.com/test/repo',
        agentId: 'bob@host',
        agentService,
      });

      const titles = results.map(r => r.title);
      expect(titles).not.toContain('Private to Alice');
      expect(titles).toContain('Engineering Dept');
      expect(titles).toContain('Project Wide');
      expect(titles).toContain('Public Info');
      expect(results.length).toBe(3);
    });
  });

  describe('Carol (marketing)', () => {
    it('should see only project/public, not department or private', () => {
      const results = searchObservationsWithVisibility({
        project: 'github.com/test/repo',
        agentId: 'carol@host',
        agentService,
      });

      const titles = results.map(r => r.title);
      expect(titles).not.toContain('Private to Alice');
      expect(titles).not.toContain('Engineering Dept');
      expect(titles).toContain('Project Wide');
      expect(titles).toContain('Public Info');
      expect(results.length).toBe(2);
    });
  });

  describe('Legacy mode (no agent)', () => {
    it('should see project and public only', () => {
      const results = searchObservationsWithVisibility({
        project: 'github.com/test/repo',
        // No agentId - legacy mode
      });

      const titles = results.map(r => r.title);
      expect(titles).not.toContain('Private to Alice');
      expect(titles).not.toContain('Engineering Dept');
      expect(titles).toContain('Project Wide');
      expect(titles).toContain('Public Info');
      expect(results.length).toBe(2);
    });
  });

  describe('Unknown agent', () => {
    it('should see project and public only', () => {
      const results = searchObservationsWithVisibility({
        project: 'github.com/test/repo',
        agentId: 'unknown@host',
        agentService,
      });

      const titles = results.map(r => r.title);
      expect(titles).not.toContain('Private to Alice');
      expect(titles).not.toContain('Engineering Dept');
      expect(titles).toContain('Project Wide');
      expect(titles).toContain('Public Info');
      expect(results.length).toBe(2);
    });
  });
});
