/**
 * Agent API Routes Tests
 *
 * Tests for agent management endpoints:
 * - POST /api/agents/register
 * - POST /api/agents/verify
 * - POST /api/agents/rotate-key
 * - POST /api/agents/revoke
 * - GET /api/agents/me
 *
 * Part of Phase 2: Multi-Agent Architecture (#15)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Database } from 'bun:sqlite';
import express from 'express';
import request from 'supertest';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { AgentService } from '../../src/services/agents/AgentService.js';
import { AgentRoutes } from '../../src/services/worker/http/routes/AgentRoutes.js';

describe('Agent API Routes', () => {
  let db: Database;
  let app: express.Express;
  let agentService: AgentService;
  let testApiKey: string;

  beforeEach(() => {
    // Create in-memory database with migrations
    db = new ClaudeMemDatabase(':memory:').db;
    agentService = new AgentService(db);

    // Create Express app with JSON parsing
    app = express();
    app.use(express.json());

    // Register agent routes
    const agentRoutes = new AgentRoutes(db, agentService);
    agentRoutes.register(app);

    // Create a verified test agent for protected route tests
    const result = agentService.registerAgent({
      id: 'existing@host',
      department: 'engineering',
    });
    testApiKey = result.apiKey!;
    agentService.verifyAgent('existing@host', testApiKey);
  });

  afterEach(() => {
    db.close();
  });

  describe('POST /api/agents/register', () => {
    it('should create new agent with API key', async () => {
      const res = await request(app)
        .post('/api/agents/register')
        .send({ id: 'new@host', department: 'engineering' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.agent.id).toBe('new@host');
      expect(res.body.agent.department).toBe('engineering');
      expect(res.body.apiKey).toMatch(/^cm_/);
    });

    it('should return existing agent without new key', async () => {
      const res = await request(app)
        .post('/api/agents/register')
        .send({ id: 'existing@host', department: 'engineering' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.agent.id).toBe('existing@host');
      expect(res.body.apiKey).toBeUndefined();
    });

    it('should accept optional permissions parameter', async () => {
      const res = await request(app)
        .post('/api/agents/register')
        .send({ id: 'perm@host', department: 'ops', permissions: 'read' });

      expect(res.status).toBe(200);
      expect(res.body.agent.permissions).toBe('read');
    });

    it('should return 400 for missing id', async () => {
      const res = await request(app)
        .post('/api/agents/register')
        .send({ department: 'engineering' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
    });

    it('should return 400 for missing department', async () => {
      const res = await request(app)
        .post('/api/agents/register')
        .send({ id: 'test@host' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
    });

    it('should return 400 for invalid ID format', async () => {
      const res = await request(app)
        .post('/api/agents/register')
        .send({ id: 'invalid-no-at', department: 'engineering' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_ID_FORMAT');
    });
  });

  describe('POST /api/agents/verify', () => {
    it('should succeed with correct key', async () => {
      // Register new agent first
      const regRes = await request(app)
        .post('/api/agents/register')
        .send({ id: 'verifytest@host', department: 'test' });

      const res = await request(app)
        .post('/api/agents/verify')
        .send({ id: 'verifytest@host', apiKey: regRes.body.apiKey });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.agent.verified).toBe(true);
    });

    it('should fail with wrong key', async () => {
      const res = await request(app)
        .post('/api/agents/verify')
        .send({ id: 'existing@host', apiKey: 'cm_wrongkey12345678901234567890' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('should return 400 for missing fields', async () => {
      const res = await request(app)
        .post('/api/agents/verify')
        .send({ id: 'test@host' }); // Missing apiKey

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_REQUEST');
    });

    it('should return 429 for locked agent', async () => {
      // Lock the agent by setting locked_until_epoch
      db.run(
        `UPDATE agents SET locked_until_epoch = ? WHERE id = 'existing@host'`,
        [Math.floor(Date.now() / 1000) + 300]
      );

      const res = await request(app)
        .post('/api/agents/verify')
        .send({ id: 'existing@host', apiKey: testApiKey });

      expect(res.status).toBe(429);
      expect(res.body.error).toBe('TOO_MANY_REQUESTS');
    });
  });

  describe('POST /api/agents/rotate-key', () => {
    it('should generate new key when authenticated', async () => {
      const res = await request(app)
        .post('/api/agents/rotate-key')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.apiKey).toMatch(/^cm_/);
      expect(res.body.apiKey).not.toBe(testApiKey);
      expect(res.body.expiresAt).toBeDefined();
    });

    it('should accept custom expiryDays', async () => {
      const res = await request(app)
        .post('/api/agents/rotate-key')
        .set('Authorization', `Bearer ${testApiKey}`)
        .send({ expiryDays: 30 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.apiKey).toMatch(/^cm_/);
    });

    it('should reject without auth', async () => {
      const res = await request(app).post('/api/agents/rotate-key');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });
  });

  describe('POST /api/agents/revoke', () => {
    it('should revoke key when authenticated', async () => {
      const res = await request(app)
        .post('/api/agents/revoke')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should make key unusable after revocation', async () => {
      // Revoke the key
      await request(app)
        .post('/api/agents/revoke')
        .set('Authorization', `Bearer ${testApiKey}`);

      // Try to use revoked key
      const check = await request(app)
        .get('/api/agents/me')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(check.status).toBe(401);
    });

    it('should reject without auth', async () => {
      const res = await request(app).post('/api/agents/revoke');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /api/agents/me', () => {
    it('should return agent info when authenticated', async () => {
      const res = await request(app)
        .get('/api/agents/me')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.agent.id).toBe('existing@host');
      expect(res.body.agent.department).toBe('engineering');
      expect(res.body.agent.verified).toBe(true);
    });

    it('should include days_until_expiry', async () => {
      const res = await request(app)
        .get('/api/agents/me')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(typeof res.body.agent.days_until_expiry).toBe('number');
      expect(res.body.agent.days_until_expiry).toBeGreaterThan(0);
    });

    it('should include key_last_rotated', async () => {
      const res = await request(app)
        .get('/api/agents/me')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.agent.key_last_rotated).toBeDefined();
    });

    it('should reject without auth', async () => {
      const res = await request(app).get('/api/agents/me');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED');
    });

    it('should not expose sensitive fields', async () => {
      const res = await request(app)
        .get('/api/agents/me')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      // Sensitive fields should not be present
      expect(res.body.agent.api_key_hash).toBeUndefined();
      expect(res.body.agent.api_key_prefix).toBeUndefined();
      expect(res.body.agent.failed_attempts).toBeUndefined();
      expect(res.body.agent.locked_until_epoch).toBeUndefined();
    });

    // Task 4.4: Enhanced Agent Self-Info tests
    describe('Enhanced fields (Task 4.4)', () => {
      it('should include all enhanced fields', async () => {
        const res = await request(app)
          .get('/api/agents/me')
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        const agent = res.body.agent;

        // All enhanced fields should be present
        expect(agent.id).toBeDefined();
        expect(agent.department).toBeDefined();
        expect(agent.permissions).toBeDefined();
        expect(agent.verified).toBeDefined();
        expect(agent.created_at).toBeDefined();
        expect(agent.last_seen_at).toBeDefined();
        expect(agent.key_expires_at).toBeDefined();
        expect(agent.key_last_rotated).toBeDefined();
        expect(agent.days_until_expiry).toBeDefined();
        expect(agent.should_rotate).toBeDefined();
        expect(agent.rotation_recommended_at).toBeDefined();
      });

      it('should set should_rotate to false when expiry is far away', async () => {
        // Default expiry is 90 days, so should_rotate should be false
        const res = await request(app)
          .get('/api/agents/me')
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.agent.should_rotate).toBe(false);
        expect(res.body.agent.days_until_expiry).toBeGreaterThan(15);
      });

      it('should set should_rotate to true when less than 15 days remain', async () => {
        // Set expiry to 10 days from now
        const tenDaysFromNow = Math.floor(Date.now() / 1000) + 10 * 86400;
        db.run(`UPDATE agents SET expires_at_epoch = ? WHERE id = 'existing@host'`, [
          tenDaysFromNow,
        ]);

        const res = await request(app)
          .get('/api/agents/me')
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.agent.should_rotate).toBe(true);
        expect(res.body.agent.days_until_expiry).toBeLessThanOrEqual(10);
      });

      it('should set should_rotate to false when exactly 15 days remain', async () => {
        // Set expiry to exactly 15 days from now
        const fifteenDaysFromNow = Math.floor(Date.now() / 1000) + 15 * 86400;
        db.run(`UPDATE agents SET expires_at_epoch = ? WHERE id = 'existing@host'`, [
          fifteenDaysFromNow,
        ]);

        const res = await request(app)
          .get('/api/agents/me')
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.agent.should_rotate).toBe(false);
      });

      it('should calculate rotation_recommended_at as 15 days before expiry', async () => {
        const res = await request(app)
          .get('/api/agents/me')
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        const agent = res.body.agent;

        // Verify rotation_recommended_at is 15 days before key_expires_at
        const expiresAt = new Date(agent.key_expires_at).getTime();
        const recommendedAt = new Date(agent.rotation_recommended_at).getTime();
        const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;

        expect(expiresAt - recommendedAt).toBe(fifteenDaysMs);
      });

      it('should handle agents without expiration', async () => {
        // Set expires_at_epoch to NULL
        db.run(`UPDATE agents SET expires_at_epoch = NULL, expires_at = NULL WHERE id = 'existing@host'`);

        const res = await request(app)
          .get('/api/agents/me')
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.agent.days_until_expiry).toBeNull();
        expect(res.body.agent.should_rotate).toBe(false);
        expect(res.body.agent.rotation_recommended_at).toBeNull();
      });

      it('should include created_at in response', async () => {
        const res = await request(app)
          .get('/api/agents/me')
          .set('Authorization', `Bearer ${testApiKey}`);

        expect(res.status).toBe(200);
        expect(res.body.agent.created_at).toBeDefined();
        // Verify it's a valid ISO timestamp
        const parsedDate = new Date(res.body.agent.created_at);
        expect(parsedDate.toString()).not.toBe('Invalid Date');
      });
    });
  });
});
