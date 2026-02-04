/**
 * Observation Agent Metadata Tests (Task 2.5)
 * Tests that observations and session summaries properly accept and store agent metadata
 *
 * Tests:
 * - storeObservation() with agent, department, visibility
 * - storeSummary() with agent, department, visibility
 * - Default values when metadata not provided
 * - Validation of visibility values
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import {
  storeObservation,
  getObservationById,
} from '../../src/services/sqlite/Observations.js';
import {
  storeSummary,
  getSummaryById,
} from '../../src/services/sqlite/Summaries.js';
import {
  createSDKSession,
  updateMemorySessionId,
} from '../../src/services/sqlite/Sessions.js';
import type { ObservationInput } from '../../src/services/sqlite/observations/types.js';
import type { SummaryInput } from '../../src/services/sqlite/summaries/types.js';
import type { Database } from 'bun:sqlite';

describe('Observation Agent Metadata', () => {
  let db: Database;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
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
      concepts: ['concept1', 'concept2'],
      files_read: ['/path/to/file1.ts'],
      files_modified: ['/path/to/file2.ts'],
      ...overrides,
    };
  }

  // Helper to create a valid summary input
  function createSummaryInput(overrides: Partial<SummaryInput> = {}): SummaryInput {
    return {
      request: 'User requested feature X',
      investigated: 'Explored the codebase',
      learned: 'Discovered pattern Y',
      completed: 'Implemented feature X',
      next_steps: 'Add tests and documentation',
      notes: 'Consider edge case Z',
      ...overrides,
    };
  }

  // Helper to create a session and return memory_session_id for FK constraints
  function createSessionWithMemoryId(
    contentSessionId: string,
    memorySessionId: string,
    project: string = 'test-project'
  ): string {
    const sessionId = createSDKSession(db, contentSessionId, project, 'initial prompt');
    updateMemorySessionId(db, sessionId, memorySessionId);
    return memorySessionId;
  }

  describe('storeObservation with agent metadata', () => {
    it('should store observation with all metadata fields', () => {
      const memorySessionId = createSessionWithMemoryId('content-meta-1', 'mem-session-meta-1');
      const project = 'test-project';
      const observation = createObservationInput({
        agent: 'seb@laptop',
        department: 'engineering',
        visibility: 'department',
      });

      const result = storeObservation(db, memorySessionId, project, observation);

      const stored = getObservationById(db, result.id);
      expect(stored).not.toBeNull();
      expect(stored?.agent).toBe('seb@laptop');
      expect(stored?.department).toBe('engineering');
      expect(stored?.visibility).toBe('department');
    });

    it('should use defaults when metadata not provided', () => {
      const memorySessionId = createSessionWithMemoryId('content-defaults-1', 'mem-session-defaults-1');
      const project = 'test-project';
      const observation = createObservationInput();
      // No agent, department, visibility provided

      const result = storeObservation(db, memorySessionId, project, observation);

      const stored = getObservationById(db, result.id);
      expect(stored).not.toBeNull();
      expect(stored?.agent).toBe('legacy');
      expect(stored?.department).toBe('default');
      expect(stored?.visibility).toBe('project');
    });

    it('should reject invalid visibility value', () => {
      const memorySessionId = createSessionWithMemoryId('content-invalid-1', 'mem-session-invalid-1');
      const project = 'test-project';
      const observation = createObservationInput({
        visibility: 'invalid' as any,
      });

      expect(() => {
        storeObservation(db, memorySessionId, project, observation);
      }).toThrow();
    });

    it('should allow all valid visibility values', () => {
      const visibilities = ['private', 'department', 'project', 'public'] as const;

      for (const visibility of visibilities) {
        const memorySessionId = createSessionWithMemoryId(
          `content-vis-${visibility}`,
          `mem-session-vis-${visibility}`
        );

        const observation = createObservationInput({ visibility });
        const result = storeObservation(db, memorySessionId, 'test-project', observation);

        const stored = getObservationById(db, result.id);
        expect(stored?.visibility).toBe(visibility);
      }
    });

    it('should allow partial metadata (only agent)', () => {
      const memorySessionId = createSessionWithMemoryId('content-partial-1', 'mem-session-partial-1');
      const observation = createObservationInput({
        agent: 'alice@server',
      });

      const result = storeObservation(db, memorySessionId, 'test-project', observation);

      const stored = getObservationById(db, result.id);
      expect(stored?.agent).toBe('alice@server');
      expect(stored?.department).toBe('default');
      expect(stored?.visibility).toBe('project');
    });

    it('should allow partial metadata (only visibility)', () => {
      const memorySessionId = createSessionWithMemoryId('content-partial-2', 'mem-session-partial-2');
      const observation = createObservationInput({
        visibility: 'private',
      });

      const result = storeObservation(db, memorySessionId, 'test-project', observation);

      const stored = getObservationById(db, result.id);
      expect(stored?.agent).toBe('legacy');
      expect(stored?.department).toBe('default');
      expect(stored?.visibility).toBe('private');
    });
  });

  describe('storeSummary with agent metadata', () => {
    it('should store session summary with all metadata fields', () => {
      const memorySessionId = createSessionWithMemoryId('content-sum-meta-1', 'mem-session-sum-meta-1');
      const project = 'test-project';
      const summary = createSummaryInput({
        agent: 'bob@workstation',
        department: 'research',
        visibility: 'private',
      });

      const result = storeSummary(db, memorySessionId, project, summary);

      const stored = getSummaryById(db, result.id);
      expect(stored).not.toBeNull();
      expect(stored?.agent).toBe('bob@workstation');
      expect(stored?.department).toBe('research');
      expect(stored?.visibility).toBe('private');
    });

    it('should use defaults when metadata not provided', () => {
      const memorySessionId = createSessionWithMemoryId('content-sum-defaults-1', 'mem-session-sum-defaults-1');
      const project = 'test-project';
      const summary = createSummaryInput();
      // No agent, department, visibility provided

      const result = storeSummary(db, memorySessionId, project, summary);

      const stored = getSummaryById(db, result.id);
      expect(stored).not.toBeNull();
      expect(stored?.agent).toBe('legacy');
      expect(stored?.department).toBe('default');
      expect(stored?.visibility).toBe('project');
    });

    it('should reject invalid visibility value', () => {
      const memorySessionId = createSessionWithMemoryId('content-sum-invalid-1', 'mem-session-sum-invalid-1');
      const project = 'test-project';
      const summary = createSummaryInput({
        visibility: 'not-valid' as any,
      });

      expect(() => {
        storeSummary(db, memorySessionId, project, summary);
      }).toThrow();
    });

    it('should allow all valid visibility values', () => {
      const visibilities = ['private', 'department', 'project', 'public'] as const;

      for (const visibility of visibilities) {
        const memorySessionId = createSessionWithMemoryId(
          `content-sum-vis-${visibility}`,
          `mem-session-sum-vis-${visibility}`
        );

        const summary = createSummaryInput({ visibility });
        const result = storeSummary(db, memorySessionId, 'test-project', summary);

        const stored = getSummaryById(db, result.id);
        expect(stored?.visibility).toBe(visibility);
      }
    });

    it('should allow partial metadata (only department)', () => {
      const memorySessionId = createSessionWithMemoryId('content-sum-partial-1', 'mem-session-sum-partial-1');
      const summary = createSummaryInput({
        department: 'marketing',
      });

      const result = storeSummary(db, memorySessionId, 'test-project', summary);

      const stored = getSummaryById(db, result.id);
      expect(stored?.agent).toBe('legacy');
      expect(stored?.department).toBe('marketing');
      expect(stored?.visibility).toBe('project');
    });
  });
});
