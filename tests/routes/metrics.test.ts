/**
 * Metrics Endpoint Tests (Task 4.3)
 *
 * Tests the /api/metrics endpoint for system monitoring:
 * - Agent statistics (total, verified, locked, active)
 * - Auth statistics (failed attempts, lockouts)
 * - Alias statistics (total, per-project averages)
 * - Observation statistics (total, by visibility)
 *
 * Sources:
 * - Task spec: docs/plans/agents/task-4.3-metrics-endpoint.md
 * - Specification: docs/plans/agents/specs/task-4.3.spec.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Database } from 'bun:sqlite';
import express from 'express';
import request from 'supertest';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { MetricsRoutes } from '../../src/services/worker/http/routes/MetricsRoutes.js';

describe('Metrics Endpoint', () => {
  let db: Database;
  let app: express.Express;

  beforeEach(() => {
    // Create in-memory database with migrations
    db = new ClaudeMemDatabase(':memory:').db;

    // Create Express app with JSON parsing
    app = express();
    app.use(express.json());

    // Register metrics routes
    const metricsRoutes = new MetricsRoutes(db);
    metricsRoutes.setupRoutes(app);
  });

  afterEach(() => {
    db.close();
  });

  describe('GET /api/metrics', () => {
    it('should return valid JSON with 200 status', async () => {
      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });

    it('should contain timestamp field in ISO format', async () => {
      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.timestamp).toBeDefined();
      // Should be a valid ISO date string
      const timestamp = new Date(res.body.timestamp);
      expect(timestamp.toISOString()).toBe(res.body.timestamp);
    });

    it('should contain all agent metric fields', async () => {
      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.agents).toBeDefined();
      expect(typeof res.body.agents.total).toBe('number');
      expect(typeof res.body.agents.verified).toBe('number');
      expect(typeof res.body.agents.locked).toBe('number');
      expect(typeof res.body.agents.active_24h).toBe('number');
    });

    it('should contain all auth metric fields', async () => {
      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.auth).toBeDefined();
      expect(typeof res.body.auth.failed_attempts_1h).toBe('number');
      expect(typeof res.body.auth.lockouts_24h).toBe('number');
    });

    it('should contain all alias metric fields', async () => {
      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.aliases).toBeDefined();
      expect(typeof res.body.aliases.total).toBe('number');
      expect(typeof res.body.aliases.projects_with_aliases).toBe('number');
      expect(typeof res.body.aliases.max_per_project).toBe('number');
      expect(typeof res.body.aliases.avg_per_project).toBe('number');
    });

    it('should contain all observation metric fields', async () => {
      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.observations).toBeDefined();
      expect(typeof res.body.observations.total).toBe('number');
      expect(Array.isArray(res.body.observations.by_visibility)).toBe(true);
    });

    it('should return non-negative values', async () => {
      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.agents.total).toBeGreaterThanOrEqual(0);
      expect(res.body.agents.verified).toBeGreaterThanOrEqual(0);
      expect(res.body.agents.locked).toBeGreaterThanOrEqual(0);
      expect(res.body.agents.active_24h).toBeGreaterThanOrEqual(0);
      expect(res.body.auth.failed_attempts_1h).toBeGreaterThanOrEqual(0);
      expect(res.body.auth.lockouts_24h).toBeGreaterThanOrEqual(0);
      expect(res.body.aliases.total).toBeGreaterThanOrEqual(0);
      expect(res.body.observations.total).toBeGreaterThanOrEqual(0);
    });

    it('should work with empty database', async () => {
      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.agents.total).toBe(0);
      expect(res.body.aliases.total).toBe(0);
      expect(res.body.observations.total).toBe(0);
    });
  });

  describe('Agent Metrics', () => {
    it('should count total agents correctly', async () => {
      const now = Math.floor(Date.now() / 1000);

      // Insert test agents
      db.run(`
        INSERT INTO agents (id, api_key_hash, created_at_epoch, verified)
        VALUES ('agent1@host', 'hash1', ?, 1)
      `, [now]);
      db.run(`
        INSERT INTO agents (id, api_key_hash, created_at_epoch, verified)
        VALUES ('agent2@host', 'hash2', ?, 0)
      `, [now]);

      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.agents.total).toBe(2);
    });

    it('should count verified agents correctly', async () => {
      const now = Math.floor(Date.now() / 1000);

      db.run(`
        INSERT INTO agents (id, api_key_hash, created_at_epoch, verified)
        VALUES ('verified@host', 'hash1', ?, 1)
      `, [now]);
      db.run(`
        INSERT INTO agents (id, api_key_hash, created_at_epoch, verified)
        VALUES ('unverified@host', 'hash2', ?, 0)
      `, [now]);

      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.agents.verified).toBe(1);
    });

    it('should count locked agents correctly', async () => {
      const now = Math.floor(Date.now() / 1000);

      // Locked agent (locked for another hour)
      db.run(`
        INSERT INTO agents (id, api_key_hash, created_at_epoch, verified, locked_until_epoch)
        VALUES ('locked@host', 'hash1', ?, 1, ?)
      `, [now, now + 3600]);
      // Not locked agent
      db.run(`
        INSERT INTO agents (id, api_key_hash, created_at_epoch, verified)
        VALUES ('notlocked@host', 'hash2', ?, 1)
      `, [now]);
      // Previously locked agent (lock expired)
      db.run(`
        INSERT INTO agents (id, api_key_hash, created_at_epoch, verified, locked_until_epoch)
        VALUES ('expired@host', 'hash3', ?, 1, ?)
      `, [now, now - 3600]);

      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.agents.locked).toBe(1);
    });

    it('should count active agents in last 24 hours', async () => {
      const now = Math.floor(Date.now() / 1000);
      const twentyThreeHoursAgo = now - (23 * 3600);
      const twentyFiveHoursAgo = now - (25 * 3600);

      // Active agent (seen 23 hours ago)
      db.run(`
        INSERT INTO agents (id, api_key_hash, created_at_epoch, verified, last_seen_at_epoch)
        VALUES ('active@host', 'hash1', ?, 1, ?)
      `, [now, twentyThreeHoursAgo]);
      // Inactive agent (seen 25 hours ago)
      db.run(`
        INSERT INTO agents (id, api_key_hash, created_at_epoch, verified, last_seen_at_epoch)
        VALUES ('inactive@host', 'hash2', ?, 1, ?)
      `, [now, twentyFiveHoursAgo]);

      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.agents.active_24h).toBe(1);
    });
  });

  describe('Auth Metrics', () => {
    it('should count failed auth attempts in last hour', async () => {
      const now = Math.floor(Date.now() / 1000);
      const thirtyMinutesAgo = now - (30 * 60);
      const twoHoursAgo = now - (2 * 3600);

      // Failed attempt within last hour
      db.run(`
        INSERT INTO audit_log (agent_id, action, created_at_epoch)
        VALUES ('test@host', 'verify_failed', ?)
      `, [thirtyMinutesAgo]);
      // Failed attempt more than an hour ago
      db.run(`
        INSERT INTO audit_log (agent_id, action, created_at_epoch)
        VALUES ('test@host', 'verify_failed', ?)
      `, [twoHoursAgo]);
      // Different action (should not count)
      db.run(`
        INSERT INTO audit_log (agent_id, action, created_at_epoch)
        VALUES ('test@host', 'agent_registered', ?)
      `, [thirtyMinutesAgo]);

      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.auth.failed_attempts_1h).toBe(1);
    });

    it('should count lockouts in last 24 hours', async () => {
      const now = Math.floor(Date.now() / 1000);
      const twelveHoursAgo = now - (12 * 3600);
      const thirtyHoursAgo = now - (30 * 3600);

      // Lockout within last 24 hours
      db.run(`
        INSERT INTO audit_log (agent_id, action, created_at_epoch)
        VALUES ('test@host', 'agent_locked', ?)
      `, [twelveHoursAgo]);
      // Lockout more than 24 hours ago
      db.run(`
        INSERT INTO audit_log (agent_id, action, created_at_epoch)
        VALUES ('test@host', 'agent_locked', ?)
      `, [thirtyHoursAgo]);

      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.auth.lockouts_24h).toBe(1);
    });
  });

  describe('Alias Metrics', () => {
    it('should count total aliases correctly', async () => {
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('old1', 'github.com/test/1')`);
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('old2', 'github.com/test/2')`);
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('old3', 'github.com/test/1')`);

      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.aliases.total).toBe(3);
    });

    it('should count unique projects with aliases', async () => {
      // Two aliases pointing to same project
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('old1', 'github.com/test/1')`);
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('old2', 'github.com/test/1')`);
      // One alias pointing to different project
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('old3', 'github.com/test/2')`);

      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.aliases.projects_with_aliases).toBe(2);
    });

    it('should calculate max aliases per project', async () => {
      // Project 1 has 3 aliases
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('a1', 'github.com/test/1')`);
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('a2', 'github.com/test/1')`);
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('a3', 'github.com/test/1')`);
      // Project 2 has 1 alias
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('b1', 'github.com/test/2')`);

      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.aliases.max_per_project).toBe(3);
    });

    it('should calculate average aliases per project', async () => {
      // Project 1 has 3 aliases
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('a1', 'github.com/test/1')`);
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('a2', 'github.com/test/1')`);
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('a3', 'github.com/test/1')`);
      // Project 2 has 1 alias
      db.run(`INSERT INTO project_aliases (old_project, new_project) VALUES ('b1', 'github.com/test/2')`);
      // Average: (3 + 1) / 2 = 2.0

      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.aliases.avg_per_project).toBe(2.0);
    });

    it('should handle no aliases gracefully', async () => {
      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.aliases.total).toBe(0);
      expect(res.body.aliases.projects_with_aliases).toBe(0);
      expect(res.body.aliases.max_per_project).toBe(0);
      expect(res.body.aliases.avg_per_project).toBe(0);
    });
  });

  describe('Observation Metrics', () => {
    beforeEach(() => {
      // Create required session first (sdk_sessions uses started_at, not created_at)
      db.run(`
        INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch)
        VALUES ('content-test-session', 'test-session', 'test-project', datetime('now'), ?)
      `, [Math.floor(Date.now() / 1000)]);
    });

    it('should count total observations correctly', async () => {
      const now = Math.floor(Date.now() / 1000);

      db.run(`
        INSERT INTO observations (memory_session_id, project, type, created_at, created_at_epoch, visibility)
        VALUES ('test-session', 'test-project', 'decision', datetime('now'), ?, 'project')
      `, [now]);
      db.run(`
        INSERT INTO observations (memory_session_id, project, type, created_at, created_at_epoch, visibility)
        VALUES ('test-session', 'test-project', 'bugfix', datetime('now'), ?, 'department')
      `, [now]);

      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.observations.total).toBe(2);
    });

    it('should group observations by visibility', async () => {
      const now = Math.floor(Date.now() / 1000);

      // 3 project-level observations
      for (let i = 0; i < 3; i++) {
        db.run(`
          INSERT INTO observations (memory_session_id, project, type, created_at, created_at_epoch, visibility)
          VALUES ('test-session', 'test-project', 'decision', datetime('now'), ?, 'project')
        `, [now]);
      }
      // 2 department-level observations
      for (let i = 0; i < 2; i++) {
        db.run(`
          INSERT INTO observations (memory_session_id, project, type, created_at, created_at_epoch, visibility)
          VALUES ('test-session', 'test-project', 'bugfix', datetime('now'), ?, 'department')
        `, [now]);
      }
      // 1 private observation
      db.run(`
        INSERT INTO observations (memory_session_id, project, type, created_at, created_at_epoch, visibility)
        VALUES ('test-session', 'test-project', 'discovery', datetime('now'), ?, 'private')
      `, [now]);

      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.observations.total).toBe(6);

      const byVisibility = res.body.observations.by_visibility;
      const projectCount = byVisibility.find((v: any) => v.visibility === 'project')?.count ?? 0;
      const departmentCount = byVisibility.find((v: any) => v.visibility === 'department')?.count ?? 0;
      const privateCount = byVisibility.find((v: any) => v.visibility === 'private')?.count ?? 0;

      expect(projectCount).toBe(3);
      expect(departmentCount).toBe(2);
      expect(privateCount).toBe(1);
    });

    it('should handle no observations gracefully', async () => {
      const res = await request(app).get('/api/metrics');

      expect(res.status).toBe(200);
      expect(res.body.observations.total).toBe(0);
      expect(res.body.observations.by_visibility).toEqual([]);
    });
  });
});
