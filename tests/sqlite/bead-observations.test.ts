/**
 * Tests for bead_id observation linking (GH #69)
 *
 * Verifies that:
 * 1. Migration 24 adds bead_id column to observations and pending_messages
 * 2. storeObservation persists bead_id correctly
 * 3. storeObservation works without bead_id (NULL, backward compat)
 * 4. Search filters by bead_id
 * 5. CURRENT_BEAD env var flows through normalizeInput
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import {
  storeObservation,
  getObservationById,
} from '../../src/services/sqlite/Observations.js';
import {
  createSDKSession,
  updateMemorySessionId,
} from '../../src/services/sqlite/Sessions.js';
import type { ObservationInput } from '../../src/services/sqlite/observations/types.js';
import type { Database } from 'bun:sqlite';

describe('Bead Observations (GH #69)', () => {
  let db: Database;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
  });

  afterEach(() => {
    db.close();
  });

  function createObservationInput(overrides: Partial<ObservationInput> = {}): ObservationInput {
    return {
      type: 'discovery',
      title: 'Test Observation',
      subtitle: 'Test Subtitle',
      facts: ['fact1'],
      narrative: 'Test narrative',
      concepts: ['concept1'],
      files_read: ['/path/to/file.ts'],
      files_modified: [],
      ...overrides,
    };
  }

  function createSessionWithMemoryId(contentSessionId: string, memorySessionId: string, project: string = 'test-project'): string {
    const sessionId = createSDKSession(db, contentSessionId, project, 'initial prompt');
    updateMemorySessionId(db, sessionId, memorySessionId);
    return memorySessionId;
  }

  describe('Migration 24: bead_id columns', () => {
    it('should add bead_id column to observations table', () => {
      const columns = db.query('PRAGMA table_info(observations)').all() as any[];
      const beadCol = columns.find((c: any) => c.name === 'bead_id');
      expect(beadCol).toBeDefined();
      expect(beadCol.type).toBe('TEXT');
    });

    it('should add bead_id column to pending_messages table', () => {
      const columns = db.query('PRAGMA table_info(pending_messages)').all() as any[];
      const beadCol = columns.find((c: any) => c.name === 'bead_id');
      expect(beadCol).toBeDefined();
      expect(beadCol.type).toBe('TEXT');
    });

    it('should create index on observations.bead_id', () => {
      const indexes = db.query('PRAGMA index_list(observations)').all() as any[];
      const beadIndex = indexes.find((idx: any) => idx.name === 'idx_observations_bead_id');
      expect(beadIndex).toBeDefined();
    });
  });

  describe('storeObservation with bead_id', () => {
    it('should store observation with bead_id', () => {
      const memorySessionId = createSessionWithMemoryId('content-bead-1', 'mem-bead-1');
      const observation = createObservationInput({ bead_id: 'bd-1c3' });

      const result = storeObservation(db, memorySessionId, 'test-project', observation);
      expect(result.id).toBeGreaterThan(0);

      // Verify bead_id is stored
      const row = db.query('SELECT bead_id FROM observations WHERE id = ?').get(result.id) as any;
      expect(row.bead_id).toBe('bd-1c3');
    });

    it('should store observation without bead_id (NULL)', () => {
      const memorySessionId = createSessionWithMemoryId('content-bead-2', 'mem-bead-2');
      const observation = createObservationInput(); // no bead_id

      const result = storeObservation(db, memorySessionId, 'test-project', observation);
      expect(result.id).toBeGreaterThan(0);

      // Verify bead_id is NULL
      const row = db.query('SELECT bead_id FROM observations WHERE id = ?').get(result.id) as any;
      expect(row.bead_id).toBeNull();
    });
  });

  describe('Search filter by bead_id', () => {
    it('should filter observations by bead_id', () => {
      const memorySessionId = createSessionWithMemoryId('content-bead-3', 'mem-bead-3');

      // Store two observations: one with bead, one without
      storeObservation(db, memorySessionId, 'test-project', createObservationInput({
        title: 'With bead',
        bead_id: 'bd-abc',
      }));
      storeObservation(db, memorySessionId, 'test-project', createObservationInput({
        title: 'Without bead',
      }));
      storeObservation(db, memorySessionId, 'test-project', createObservationInput({
        title: 'Different bead',
        bead_id: 'bd-xyz',
      }));

      // Query with bead_id filter
      const rows = db.query(
        "SELECT * FROM observations WHERE bead_id = ? AND visibility IN ('public', 'project')"
      ).all('bd-abc') as any[];

      expect(rows.length).toBe(1);
      expect(rows[0].title).toBe('With bead');
    });
  });
});

describe('CURRENT_BEAD env var in adapter', () => {
  it('should read CURRENT_BEAD from environment', async () => {
    // Dynamically import to test with env var set
    const originalEnv = process.env.CURRENT_BEAD;

    try {
      process.env.CURRENT_BEAD = 'bd-test-123';

      // Re-import adapter to test normalizeInput
      const { claudeCodeAdapter } = await import('../../src/cli/adapters/claude-code.js');
      const normalized = claudeCodeAdapter.normalizeInput({
        session_id: 'test-session',
        cwd: '/tmp/test',
        tool_name: 'Read',
        tool_input: {},
        tool_response: {},
      });

      expect(normalized.beadId).toBe('bd-test-123');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CURRENT_BEAD;
      } else {
        process.env.CURRENT_BEAD = originalEnv;
      }
    }
  });

  it('should be undefined when CURRENT_BEAD is not set', async () => {
    const originalEnv = process.env.CURRENT_BEAD;

    try {
      delete process.env.CURRENT_BEAD;

      const { claudeCodeAdapter } = await import('../../src/cli/adapters/claude-code.js');
      const normalized = claudeCodeAdapter.normalizeInput({
        session_id: 'test-session',
        cwd: '/tmp/test',
      });

      expect(normalized.beadId).toBeUndefined();
    } finally {
      if (originalEnv !== undefined) {
        process.env.CURRENT_BEAD = originalEnv;
      }
    }
  });
});
