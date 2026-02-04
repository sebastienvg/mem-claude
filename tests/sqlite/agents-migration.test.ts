/**
 * Agents Migration Tests (Migration 021)
 * Tests the multi-agent architecture database migration
 *
 * Tests:
 * - agents table creation with all columns
 * - audit_log table creation
 * - Extension columns on observations and session_summaries
 * - Index creation for O(1) API key lookup
 * - Unique constraints and CHECK constraints
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import type { Database } from 'bun:sqlite';

interface TableColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface IndexInfo {
  name: string;
  tbl_name: string;
  unique: number;
}

interface TableNameRow {
  name: string;
}

describe('Agents Migration (021)', () => {
  let db: Database;

  beforeEach(() => {
    // ClaudeMemDatabase runs all migrations automatically
    db = new ClaudeMemDatabase(':memory:').db;
  });

  afterEach(() => {
    db.close();
  });

  describe('agents table', () => {
    it('should create agents table', () => {
      const tables = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='agents'
      `).all() as TableNameRow[];

      expect(tables).toHaveLength(1);
    });

    it('should have all required columns', () => {
      const columns = db.query(`PRAGMA table_info(agents)`).all() as TableColumnInfo[];
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('department');
      expect(columnNames).toContain('permissions');
      expect(columnNames).toContain('api_key_prefix');
      expect(columnNames).toContain('api_key_hash');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('created_at_epoch');
      expect(columnNames).toContain('last_seen_at');
      expect(columnNames).toContain('last_seen_at_epoch');
      expect(columnNames).toContain('verified');
      expect(columnNames).toContain('expires_at');
      expect(columnNames).toContain('expires_at_epoch');
      expect(columnNames).toContain('failed_attempts');
      expect(columnNames).toContain('locked_until_epoch');
    });

    it('should have correct default values', () => {
      const columns = db.query(`PRAGMA table_info(agents)`).all() as TableColumnInfo[];

      const departmentCol = columns.find(c => c.name === 'department');
      expect(departmentCol?.dflt_value).toBe("'default'");

      const permissionsCol = columns.find(c => c.name === 'permissions');
      expect(permissionsCol?.dflt_value).toBe("'read,write'");

      const verifiedCol = columns.find(c => c.name === 'verified');
      expect(verifiedCol?.dflt_value).toBe('0');

      const failedAttemptsCol = columns.find(c => c.name === 'failed_attempts');
      expect(failedAttemptsCol?.dflt_value).toBe('0');
    });

    it('should have api_key_prefix index for O(1) lookup', () => {
      const indexes = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='agents' AND name LIKE '%api_key_prefix%'
      `).all() as IndexInfo[];

      expect(indexes.length).toBeGreaterThan(0);
    });

    it('should have api_key_hash unique index', () => {
      // First insert succeeds
      db.run(`
        INSERT INTO agents (id, api_key_hash, created_at_epoch)
        VALUES ('agent1@host', 'sha256:abc123', 1700000000)
      `);

      // Second insert with same hash should fail
      expect(() => {
        db.run(`
          INSERT INTO agents (id, api_key_hash, created_at_epoch)
          VALUES ('agent2@host', 'sha256:abc123', 1700000000)
        `);
      }).toThrow();
    });

    it('should have department index', () => {
      const indexes = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='agents' AND name LIKE '%department%'
      `).all() as IndexInfo[];

      expect(indexes.length).toBeGreaterThan(0);
    });

    it('should have verified index', () => {
      const indexes = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='agents' AND name LIKE '%verified%'
      `).all() as IndexInfo[];

      expect(indexes.length).toBeGreaterThan(0);
    });

    it('should allow inserting a complete agent record', () => {
      const now = Math.floor(Date.now() / 1000);
      db.run(`
        INSERT INTO agents (
          id, department, permissions, api_key_prefix, api_key_hash,
          created_at_epoch, last_seen_at, last_seen_at_epoch,
          verified, expires_at, expires_at_epoch, failed_attempts, locked_until_epoch
        ) VALUES (
          'test@host', 'engineering', 'read,write', 'cm_abcdefgh', 'sha256:fullhash',
          ?, '2026-02-03T12:00:00Z', ?,
          1, '2026-05-03T12:00:00Z', ?, 0, NULL
        )
      `, [now, now, now + 7776000]); // 90 days expiry

      const agent = db.query(`SELECT * FROM agents WHERE id = 'test@host'`).get() as any;
      expect(agent).toBeTruthy();
      expect(agent.id).toBe('test@host');
      expect(agent.department).toBe('engineering');
      expect(agent.permissions).toBe('read,write');
      expect(agent.verified).toBe(1);
    });
  });

  describe('audit_log table', () => {
    it('should create audit_log table', () => {
      const tables = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='audit_log'
      `).all() as TableNameRow[];

      expect(tables).toHaveLength(1);
    });

    it('should have all required columns', () => {
      const columns = db.query(`PRAGMA table_info(audit_log)`).all() as TableColumnInfo[];
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('agent_id');
      expect(columnNames).toContain('action');
      expect(columnNames).toContain('resource_type');
      expect(columnNames).toContain('resource_id');
      expect(columnNames).toContain('details');
      expect(columnNames).toContain('ip_address');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('created_at_epoch');
    });

    it('should allow inserting audit entries', () => {
      db.run(`
        INSERT INTO audit_log (agent_id, action, details, ip_address)
        VALUES ('test@host', 'login', '{"ip": "127.0.0.1"}', '127.0.0.1')
      `);

      const entry = db.query(`SELECT * FROM audit_log WHERE agent_id = 'test@host'`).get() as any;
      expect(entry).toBeTruthy();
      expect(entry.action).toBe('login');
      expect(entry.details).toBe('{"ip": "127.0.0.1"}');
    });

    it('should have required indexes', () => {
      const indexes = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='audit_log'
      `).all() as IndexInfo[];

      const indexNames = indexes.map(i => i.name);
      expect(indexNames.some(n => n.includes('agent'))).toBe(true);
      expect(indexNames.some(n => n.includes('action'))).toBe(true);
      expect(indexNames.some(n => n.includes('created'))).toBe(true);
    });

    it('should auto-generate timestamps', () => {
      const before = Math.floor(Date.now() / 1000);
      db.run(`
        INSERT INTO audit_log (agent_id, action)
        VALUES ('test@host', 'test_action')
      `);
      const after = Math.floor(Date.now() / 1000);

      const entry = db.query(`SELECT * FROM audit_log WHERE action = 'test_action'`).get() as any;
      expect(entry.created_at).toBeTruthy();
      expect(entry.created_at_epoch).toBeGreaterThanOrEqual(before);
      expect(entry.created_at_epoch).toBeLessThanOrEqual(after + 1);
    });
  });

  describe('observations extensions', () => {
    it('should have agent column', () => {
      const columns = db.query(`PRAGMA table_info(observations)`).all() as TableColumnInfo[];
      const agentCol = columns.find(c => c.name === 'agent');

      expect(agentCol).toBeTruthy();
      expect(agentCol?.dflt_value).toBe("'legacy'");
    });

    it('should have department column', () => {
      const columns = db.query(`PRAGMA table_info(observations)`).all() as TableColumnInfo[];
      const deptCol = columns.find(c => c.name === 'department');

      expect(deptCol).toBeTruthy();
      expect(deptCol?.dflt_value).toBe("'default'");
    });

    it('should have visibility column', () => {
      const columns = db.query(`PRAGMA table_info(observations)`).all() as TableColumnInfo[];
      const visCol = columns.find(c => c.name === 'visibility');

      expect(visCol).toBeTruthy();
      expect(visCol?.dflt_value).toBe("'project'");
    });

    it('should have indexes on new columns', () => {
      const indexes = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='observations'
      `).all() as IndexInfo[];

      const indexNames = indexes.map(i => i.name);
      expect(indexNames.some(n => n.includes('agent'))).toBe(true);
      expect(indexNames.some(n => n.includes('department'))).toBe(true);
      expect(indexNames.some(n => n.includes('visibility'))).toBe(true);
    });

    it('should reject invalid visibility values via CHECK constraint', () => {
      // First, we need a valid session for FK constraint
      db.run(`
        INSERT INTO sdk_sessions (content_session_id, project, started_at, started_at_epoch, status)
        VALUES ('test-session', 'test-project', '2026-02-03T12:00:00Z', 1700000000, 'active')
      `);

      const sessionId = db.query(`SELECT memory_session_id FROM sdk_sessions WHERE content_session_id = 'test-session'`).get() as any;

      // Update the session to have a memory_session_id
      db.run(`UPDATE sdk_sessions SET memory_session_id = 'mem-test-123' WHERE content_session_id = 'test-session'`);

      // Insert a valid observation
      db.run(`
        INSERT INTO observations (
          memory_session_id, project, type, title, narrative, created_at, created_at_epoch
        ) VALUES (
          'mem-test-123', 'test-project', 'discovery', 'Test', 'Test narrative', '2026-02-03T12:00:00Z', 1700000000
        )
      `);

      // Try to update with invalid visibility - should fail due to CHECK constraint
      expect(() => {
        db.run(`UPDATE observations SET visibility = 'invalid' WHERE memory_session_id = 'mem-test-123'`);
      }).toThrow();
    });

    it('should accept valid visibility values', () => {
      // Set up session
      db.run(`
        INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch, status)
        VALUES ('valid-session', 'mem-valid-123', 'test-project', '2026-02-03T12:00:00Z', 1700000000, 'active')
      `);

      const validVisibilities = ['private', 'department', 'project', 'public'];

      for (const vis of validVisibilities) {
        // Insert observation with each valid visibility
        db.run(`
          INSERT INTO observations (
            memory_session_id, project, type, title, narrative, visibility, created_at, created_at_epoch
          ) VALUES (
            'mem-valid-123', 'test-project', 'discovery', 'Test ${vis}', 'Narrative', ?, '2026-02-03T12:00:00Z', 1700000000
          )
        `, [vis]);
      }

      const count = db.query(`SELECT COUNT(*) as cnt FROM observations WHERE memory_session_id = 'mem-valid-123'`).get() as any;
      expect(count.cnt).toBe(4);
    });
  });

  describe('session_summaries extensions', () => {
    it('should have agent column', () => {
      const columns = db.query(`PRAGMA table_info(session_summaries)`).all() as TableColumnInfo[];
      const agentCol = columns.find(c => c.name === 'agent');

      expect(agentCol).toBeTruthy();
      expect(agentCol?.dflt_value).toBe("'legacy'");
    });

    it('should have department column', () => {
      const columns = db.query(`PRAGMA table_info(session_summaries)`).all() as TableColumnInfo[];
      const deptCol = columns.find(c => c.name === 'department');

      expect(deptCol).toBeTruthy();
      expect(deptCol?.dflt_value).toBe("'default'");
    });

    it('should have visibility column', () => {
      const columns = db.query(`PRAGMA table_info(session_summaries)`).all() as TableColumnInfo[];
      const visCol = columns.find(c => c.name === 'visibility');

      expect(visCol).toBeTruthy();
      expect(visCol?.dflt_value).toBe("'project'");
    });
  });

  describe('migration idempotency', () => {
    it('should handle existing tables gracefully', () => {
      // The migration already ran in beforeEach
      // Running it again should not throw
      // We test this by checking the tables still exist with correct structure

      const agentsTable = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='agents'
      `).all() as TableNameRow[];

      expect(agentsTable).toHaveLength(1);

      const auditTable = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='audit_log'
      `).all() as TableNameRow[];

      expect(auditTable).toHaveLength(1);
    });
  });
});
