/**
 * POST /api/save Endpoint Tests
 *
 * Tests the manual observation save endpoint in DataRoutes.ts.
 * Uses in-memory database with real Express handlers.
 *
 * Sources:
 * - DataRoutes from src/services/worker/http/routes/DataRoutes.ts
 * - storeObservation from src/services/sqlite/observations/store.ts
 * - ObservationInput from src/services/sqlite/observations/types.ts
 * - Test patterns from tests/sqlite/observations.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import express from 'express';
import { logger } from '../src/utils/logger.js';
import { ClaudeMemDatabase } from '../src/services/sqlite/Database.js';
import { DataRoutes } from '../src/services/worker/http/routes/DataRoutes.js';
import type { Database } from 'bun:sqlite';

// Suppress logger output during tests
let loggerSpies: ReturnType<typeof spyOn>[] = [];

// Minimal mock implementations for DataRoutes dependencies
function createMockDbManager(db: Database) {
  return {
    getSessionStore: () => ({ db }),
    getSessionSearch: () => ({}),
    getChromaSync: () => ({}),
    initialize: async () => {},
    close: async () => {},
    getSessionById: () => null,
  } as any;
}

function createMockPaginationHelper() {
  return {
    getObservations: () => ({ data: [], total: 0 }),
    getSummaries: () => ({ data: [], total: 0 }),
    getPrompts: () => ({ data: [], total: 0 }),
  } as any;
}

function createMockSessionManager() {
  return {
    isAnySessionProcessing: () => false,
    getTotalActiveWork: () => 0,
    getTotalQueueDepth: () => 0,
    getActiveSessionCount: () => 0,
  } as any;
}

function createMockSSEBroadcaster() {
  return {
    getClientCount: () => 0,
    broadcast: () => {},
  } as any;
}

function createMockWorkerService() {
  return {
    broadcastProcessingStatus: () => {},
    processPendingQueues: async () => ({ processed: 0 }),
  } as any;
}

describe('POST /api/save Endpoint', () => {
  let db: Database;
  let app: express.Application;
  let server: ReturnType<typeof app.listen>;
  let testPort: number;
  let baseUrl: string;

  beforeEach(() => {
    loggerSpies = [
      spyOn(logger, 'info').mockImplementation(() => {}),
      spyOn(logger, 'debug').mockImplementation(() => {}),
      spyOn(logger, 'warn').mockImplementation(() => {}),
      spyOn(logger, 'error').mockImplementation(() => {}),
      spyOn(logger, 'failure').mockImplementation(() => {}),
    ];

    // Set up in-memory database with full schema
    const claudeMemDb = new ClaudeMemDatabase(':memory:');
    db = claudeMemDb.db;

    // Set up Express app with DataRoutes
    app = express();
    app.use(express.json());

    const dataRoutes = new DataRoutes(
      createMockPaginationHelper(),
      createMockDbManager(db),
      createMockSessionManager(),
      createMockSSEBroadcaster(),
      createMockWorkerService(),
      Date.now()
    );
    dataRoutes.setupRoutes(app);

    testPort = 40000 + Math.floor(Math.random() * 10000);
    baseUrl = `http://127.0.0.1:${testPort}`;
  });

  afterEach(async () => {
    loggerSpies.forEach(spy => spy.mockRestore());
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    db.close();
  });

  async function startServer(): Promise<void> {
    return new Promise((resolve) => {
      server = app.listen(testPort, '127.0.0.1', () => resolve());
    });
  }

  // Test 1: Success - minimal required fields
  it('should save observation with minimal required fields', async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test', text: 'Content' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(typeof body.id).toBe('number');
    expect(typeof body.memory_session_id).toBe('string');
    expect(body.memory_session_id.startsWith('mcp-')).toBe(true);
    expect(typeof body.created_at_epoch).toBe('number');

    // Verify type defaults to 'discovery'
    const row = db.prepare('SELECT type FROM observations WHERE id = ?').get(body.id) as any;
    expect(row.type).toBe('discovery');
  });

  // Test 2: Success - all fields provided
  it('should save observation with all fields provided', async () => {
    await startServer();

    const sessionId = 'my-custom-session-123';
    const response = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Full observation',
        text: 'Detailed content here',
        type: 'decision',
        project: 'test-project',
        memory_session_id: sessionId,
        facts: ['fact1', 'fact2'],
        concepts: ['concept1'],
        files_read: ['/src/main.ts'],
        files_modified: ['/src/main.ts'],
        agent: 'test-agent',
        department: 'engineering',
        visibility: 'public',
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.memory_session_id).toBe(sessionId);

    // Verify stored values
    const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(body.id) as any;
    expect(row.type).toBe('decision');
    expect(row.project).toBe('test-project');
    expect(row.memory_session_id).toBe(sessionId);
    expect(row.agent).toBe('test-agent');
    expect(row.department).toBe('engineering');
    expect(row.visibility).toBe('public');
    expect(JSON.parse(row.facts)).toEqual(['fact1', 'fact2']);
    expect(JSON.parse(row.concepts)).toEqual(['concept1']);
  });

  // Test 3: Error - missing title
  it('should return 400 when title is missing', async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Content' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('title is required and must be a string');
  });

  // Test 4: Error - missing text
  it('should return 400 when text is missing', async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('text is required and must be a string');
  });

  // Test 5: Error - empty body
  it('should return 400 for empty body', async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });

  // Test 6: Validation - array fields handle non-array gracefully
  it('should handle non-array values for array fields gracefully', async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test',
        text: 'Content',
        facts: 'not-an-array',
        concepts: 123,
        files_read: null,
        files_modified: { key: 'value' },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    // Verify array fields defaulted to []
    const row = db.prepare('SELECT facts, concepts, files_read, files_modified FROM observations WHERE id = ?').get(body.id) as any;
    expect(JSON.parse(row.facts)).toEqual([]);
    expect(JSON.parse(row.concepts)).toEqual([]);
    expect(JSON.parse(row.files_read)).toEqual([]);
    expect(JSON.parse(row.files_modified)).toEqual([]);
  });

  // Test 7: Validation - memory_session_id grouping
  it('should group observations under same memory_session_id', async () => {
    await startServer();

    const sharedSessionId = 'shared-session-abc';

    const response1 = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Observation 1',
        text: 'First observation',
        memory_session_id: sharedSessionId,
      }),
    });

    const response2 = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Observation 2',
        text: 'Second observation',
        memory_session_id: sharedSessionId,
      }),
    });

    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);

    const body1 = await response1.json();
    const body2 = await response2.json();

    expect(body1.memory_session_id).toBe(sharedSessionId);
    expect(body2.memory_session_id).toBe(sharedSessionId);

    // Verify both observations share the same memory_session_id in DB
    const rows = db.prepare('SELECT memory_session_id FROM observations WHERE memory_session_id = ?').all(sharedSessionId) as any[];
    expect(rows.length).toBe(2);
  });

  // Test 8: Validation - invalid visibility rejected
  it('should return 500 for invalid visibility value', async () => {
    await startServer();

    const response = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test',
        text: 'Content',
        visibility: 'invalid',
      }),
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain('Invalid visibility');
  });
});
