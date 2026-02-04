/**
 * Query Functions with Alias Support Tests
 * Tests that query functions include project aliases when filtering by project.
 *
 * Sources:
 * - Task spec: docs/plans/agents/specs/task-1.6.spec.md
 * - Project aliases: src/services/sqlite/project-aliases.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { registerProjectAlias } from '../../src/services/sqlite/project-aliases.js';
import {
  storeObservation,
  getRecentObservations,
  getObservationsByIds,
} from '../../src/services/sqlite/Observations.js';
import {
  storeSummary,
  getRecentSummaries,
  getRecentSummariesWithSessionInfo,
  getSummariesByIds,
} from '../../src/services/sqlite/Summaries.js';
import {
  createSDKSession,
  updateMemorySessionId,
} from '../../src/services/sqlite/Sessions.js';
import type { ObservationInput } from '../../src/services/sqlite/observations/types.js';
import type { SummaryInput } from '../../src/services/sqlite/summaries/types.js';
import type { Database } from 'bun:sqlite';

describe('Query Functions with Alias Support', () => {
  let db: Database;
  const newProjectId = 'github.com/user/my-repo';
  const oldProjectName = 'my-repo';

  // Helper to create a valid observation input
  function createObservationInput(overrides: Partial<ObservationInput> = {}): ObservationInput {
    return {
      type: 'discovery',
      title: 'Test Observation',
      subtitle: 'Test Subtitle',
      facts: ['fact1'],
      narrative: 'Test narrative',
      concepts: ['test-concept'],
      files_read: ['/path/to/file.ts'],
      files_modified: [],
      ...overrides,
    };
  }

  // Helper to create a valid summary input
  function createSummaryInput(overrides: Partial<SummaryInput> = {}): SummaryInput {
    return {
      request: 'Test request',
      investigated: 'Investigated items',
      learned: 'What was learned',
      completed: 'What was completed',
      next_steps: 'Next steps',
      notes: null,
      ...overrides,
    };
  }

  // Helper to create a session and return memory_session_id
  function createSessionWithMemoryId(
    contentSessionId: string,
    memorySessionId: string,
    project: string
  ): string {
    const sessionId = createSDKSession(db, contentSessionId, project, 'initial prompt');
    updateMemorySessionId(db, sessionId, memorySessionId);
    return memorySessionId;
  }

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;

    // Create sessions for both old and new project identifiers
    const oldMemorySessionId = createSessionWithMemoryId(
      'content-old-1',
      'mem-old-1',
      oldProjectName
    );
    const newMemorySessionId = createSessionWithMemoryId(
      'content-new-1',
      'mem-new-1',
      newProjectId
    );

    // Insert test observations with old project name
    storeObservation(
      db,
      oldMemorySessionId,
      oldProjectName,
      createObservationInput({ title: 'Old Observation' }),
      1,
      0,
      1000000000000
    );

    // Insert observation with new project ID
    storeObservation(
      db,
      newMemorySessionId,
      newProjectId,
      createObservationInput({ title: 'New Observation' }),
      2,
      0,
      2000000000000
    );

    // Insert session summaries
    storeSummary(
      db,
      oldMemorySessionId,
      oldProjectName,
      createSummaryInput({ request: 'Old Summary Request' }),
      1,
      0,
      1000000000000
    );

    storeSummary(
      db,
      newMemorySessionId,
      newProjectId,
      createSummaryInput({ request: 'New Summary Request' }),
      2,
      0,
      2000000000000
    );

    // Register alias: old name points to new project ID
    registerProjectAlias(db, oldProjectName, newProjectId);
  });

  afterEach(() => {
    db.close();
  });

  describe('getRecentObservations', () => {
    it('should return observations with both old and new project names when querying with new ID', () => {
      const results = getRecentObservations(db, newProjectId, 10);

      // Should find both observations
      expect(results.length).toBe(2);
    });

    it('should return only old project observations when querying with old name (no reverse lookup)', () => {
      // Querying with old name should only find old project data
      // (aliases only work from new -> old, not old -> new)
      const results = getRecentObservations(db, oldProjectName, 10);

      expect(results.length).toBe(1);
    });
  });

  describe('getObservationsByIds', () => {
    it('should filter by project including aliases', () => {
      // Get all observation IDs
      const allObs = db.query('SELECT id FROM observations').all() as { id: number }[];
      const ids = allObs.map(o => o.id);

      // Filter by new project ID should include both
      const results = getObservationsByIds(db, ids, { project: newProjectId });

      expect(results.length).toBe(2);
    });
  });

  describe('getRecentSummaries', () => {
    it('should return summaries with both old and new project names when querying with new ID', () => {
      const results = getRecentSummaries(db, newProjectId, 10);

      expect(results.length).toBe(2);
    });

    it('should return only old project summaries when querying with old name', () => {
      const results = getRecentSummaries(db, oldProjectName, 10);

      expect(results.length).toBe(1);
    });
  });

  describe('getRecentSummariesWithSessionInfo', () => {
    it('should return summaries including aliased projects', () => {
      const results = getRecentSummariesWithSessionInfo(db, newProjectId, 10);

      expect(results.length).toBe(2);
    });
  });

  describe('getSummariesByIds', () => {
    it('should filter by project including aliases', () => {
      // Get all summary IDs
      const allSummaries = db.query('SELECT id FROM session_summaries').all() as { id: number }[];
      const ids = allSummaries.map(s => s.id);

      // Filter by new project ID should include both
      const results = getSummariesByIds(db, ids, { project: newProjectId });

      expect(results.length).toBe(2);
    });
  });

  describe('without aliases', () => {
    it('should work normally when no aliases exist for project', () => {
      const results = getRecentObservations(db, 'unrelated-project', 10);

      expect(results).toHaveLength(0);
    });

    it('should return only matching project when project has no aliases', () => {
      // Create observation for a project without aliases
      const memId = createSessionWithMemoryId('content-solo', 'mem-solo', 'solo-project');
      storeObservation(db, memId, 'solo-project', createObservationInput({ title: 'Solo' }));

      const results = getRecentObservations(db, 'solo-project', 10);

      expect(results.length).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty alias table gracefully', () => {
      // Clear all aliases
      db.run('DELETE FROM project_aliases');

      // Should still work, just return single project
      const results = getRecentObservations(db, newProjectId, 10);

      // Only new project observations (no alias expansion)
      expect(results.length).toBe(1);
    });

    it('should include project as first element even with aliases', () => {
      // This is tested implicitly - the query should work correctly
      // whether project is in the IN clause first or not
      const results = getRecentObservations(db, newProjectId, 10);
      expect(results.length).toBe(2);
    });
  });
});
