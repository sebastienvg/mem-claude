# Task 2.4: Add Agent API Endpoints

<!-- HANDOFF FROM TASK 2.3 -->
## Context from Previous Agent

Task 2.3 is complete. Auth middleware is now available:

```typescript
import { createAuthMiddleware, createOptionalAuthMiddleware, AuthenticatedRequest } from './middleware/auth.js';
import { authRateLimiter, apiRateLimiter, sensitiveRateLimiter } from './middleware/rate-limit.js';

const authMiddleware = createAuthMiddleware(agentService);

// Protected route
app.get('/api/protected', authMiddleware, (req: AuthenticatedRequest, res) => {
  console.log(req.agent);    // Agent object
  console.log(req.agentId);  // Agent ID string
});

// Rate-limited auth endpoint
app.post('/api/agents/verify', authRateLimiter, handler);

// Rate-limited general endpoint
app.use('/api', apiRateLimiter);

// Optional auth (attaches agent if present, continues if not)
const optionalAuth = createOptionalAuthMiddleware(agentService);
app.get('/api/public-with-auth', optionalAuth, handler);
```

### Middleware Behavior

| Scenario | createAuthMiddleware | createOptionalAuthMiddleware |
|----------|---------------------|------------------------------|
| No header | 401 UNAUTHORIZED | continues, no agent |
| Invalid key | 401 UNAUTHORIZED | continues, no agent |
| Unverified agent | 403 FORBIDDEN | continues, no agent |
| Locked agent | 429 TOO_MANY_REQUESTS | continues, no agent |
| Valid & verified | attaches agent, next() | attaches agent, next() |

### Rate Limiters

| Limiter | Window | Max | Use Case |
|---------|--------|-----|----------|
| authRateLimiter | 15 min | 20 | Auth endpoints |
| apiRateLimiter | 1 min | 100 | General API |
| sensitiveRateLimiter | 1 min | 10 | Key rotation/revocation |

Your task is to create the agent API endpoints:
- POST /api/agents/register
- POST /api/agents/verify
- POST /api/agents/rotate-key
- POST /api/agents/revoke
- GET /api/agents/me (protected)

Tests passing: `bun test tests/middleware/auth.test.ts` (19 tests)
<!-- END HANDOFF -->

**Phase:** 2 - Multi-Agent Architecture
**Issue:** #15
**Depends On:** Task 2.3 (auth middleware)
**Next Task:** `task-2.5-observation-agent-metadata.md`

---

## Objective

Create REST API endpoints for agent management: registration, verification, key rotation, and revocation.

---

## Files to Create

| File | Type |
|------|------|
| `src/services/worker/http/routes/AgentRoutes.ts` | Implementation |
| `tests/routes/agent-routes.test.ts` | Tests |
| `docs/plans/agents/specs/task-2.4.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-2.4.spec.md`:

```markdown
# Task 2.4 Specification: Agent API Endpoints

## Endpoints

### POST /api/agents/register (rate limited)
- [ ] Accepts { id, department, permissions? }
- [ ] Returns { agent, apiKey } for new agents
- [ ] Returns { agent } for existing agents
- [ ] 400 for invalid agent ID format
- [ ] Rate limited with authRateLimiter

### POST /api/agents/verify (rate limited)
- [ ] Accepts { id, apiKey }
- [ ] Returns { success: true, agent } on success
- [ ] Returns 401 on failure
- [ ] Rate limited with authRateLimiter

### POST /api/agents/rotate-key (protected)
- [ ] Requires authentication
- [ ] Agent can only rotate own key
- [ ] Accepts optional { expiryDays }
- [ ] Returns { apiKey, expiresAt }

### POST /api/agents/revoke (protected)
- [ ] Requires authentication
- [ ] Agent can only revoke own key
- [ ] Returns { success: true }

### GET /api/agents/me (protected)
- [ ] Requires authentication
- [ ] Returns agent info with key metadata
- [ ] Includes days_until_expiry

## Response Formats

### Success
```json
{
  "success": true,
  "agent": { ... },
  "apiKey": "cm_..." // Only on registration
}
```

### Error
```json
{
  "error": "ERROR_CODE",
  "message": "Human readable message"
}
```

## Test Cases
- [ ] register: Creates new agent
- [ ] register: Returns existing agent without new key
- [ ] register: Rejects invalid ID format
- [ ] verify: Succeeds with correct key
- [ ] verify: Fails with wrong key
- [ ] rotate-key: Generates new key (authenticated)
- [ ] rotate-key: Rejects without auth
- [ ] revoke: Revokes key (authenticated)
- [ ] me: Returns agent info (authenticated)
```

---

## Step 2: Write Failing Tests

Create `tests/routes/agent-routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import express from 'express';
import request from 'supertest';
import { runMigrations } from '../../src/services/sqlite/migrations.js';
import { AgentService } from '../../src/services/agents/AgentService.js';
import { AgentRoutes } from '../../src/services/worker/http/routes/AgentRoutes.js';
import { createAuthMiddleware } from '../../src/services/worker/http/middleware/auth.js';

describe('Agent API Routes', () => {
  let db: Database;
  let app: express.Express;
  let agentService: AgentService;
  let testApiKey: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    agentService = new AgentService(db);

    app = express();
    app.use(express.json());

    const agentRoutes = new AgentRoutes(db, agentService);
    agentRoutes.register(app);

    // Create a verified test agent
    const result = agentService.registerAgent({
      id: 'existing@host',
      department: 'engineering'
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
      expect(res.body.agent.id).toBe('new@host');
      expect(res.body.apiKey).toMatch(/^cm_/);
    });

    it('should return existing agent without new key', async () => {
      const res = await request(app)
        .post('/api/agents/register')
        .send({ id: 'existing@host', department: 'engineering' });

      expect(res.status).toBe(200);
      expect(res.body.agent.id).toBe('existing@host');
      expect(res.body.apiKey).toBeUndefined();
    });

    it('should reject invalid ID format', async () => {
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
        .send({ id: 'existing@host', apiKey: 'cm_wrongkey12345678901234567' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/agents/rotate-key', () => {
    it('should generate new key when authenticated', async () => {
      const res = await request(app)
        .post('/api/agents/rotate-key')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.apiKey).toMatch(/^cm_/);
      expect(res.body.apiKey).not.toBe(testApiKey);
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .post('/api/agents/rotate-key');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/agents/revoke', () => {
    it('should revoke key when authenticated', async () => {
      const res = await request(app)
        .post('/api/agents/revoke')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify key no longer works
      const check = await request(app)
        .get('/api/agents/me')
        .set('Authorization', `Bearer ${testApiKey}`);

      expect(check.status).toBe(401);
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
      expect(typeof res.body.agent.days_until_expiry).toBe('number');
    });

    it('should reject without auth', async () => {
      const res = await request(app)
        .get('/api/agents/me');

      expect(res.status).toBe(401);
    });
  });
});
```

---

## Step 3: Implement

Create `src/services/worker/http/routes/AgentRoutes.ts`:

```typescript
import { Express, Request, Response } from 'express';
import { Database } from 'bun:sqlite';
import { AgentService, AgentIdFormatError, AgentLockedError } from '../../../agents/AgentService.js';
import { createAuthMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rate-limit.js';
import { logger } from '../../../../utils/logger.js';

export class AgentRoutes {
  private authMiddleware: ReturnType<typeof createAuthMiddleware>;

  constructor(
    private db: Database,
    private agentService: AgentService
  ) {
    this.authMiddleware = createAuthMiddleware(agentService);
  }

  register(app: Express): void {
    // Public endpoints (rate limited)
    app.post('/api/agents/register', authRateLimiter, this.handleRegister.bind(this));
    app.post('/api/agents/verify', authRateLimiter, this.handleVerify.bind(this));

    // Protected endpoints
    app.post('/api/agents/rotate-key', this.authMiddleware, this.handleRotateKey.bind(this));
    app.post('/api/agents/revoke', this.authMiddleware, this.handleRevoke.bind(this));
    app.get('/api/agents/me', this.authMiddleware, this.handleGetSelf.bind(this));
  }

  private handleRegister(req: Request, res: Response): void {
    const { id, department, permissions } = req.body;

    if (!id || !department) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Required: id, department'
      });
      return;
    }

    try {
      const result = this.agentService.registerAgent({ id, department, permissions });

      res.json({
        success: true,
        agent: this.sanitizeAgent(result.agent),
        ...(result.apiKey && { apiKey: result.apiKey })
      });

    } catch (error) {
      if (error instanceof AgentIdFormatError) {
        res.status(400).json({
          error: 'INVALID_ID_FORMAT',
          message: error.message
        });
        return;
      }
      throw error;
    }
  }

  private handleVerify(req: Request, res: Response): void {
    const { id, apiKey } = req.body;

    if (!id || !apiKey) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'Required: id, apiKey'
      });
      return;
    }

    try {
      const success = this.agentService.verifyAgent(id, apiKey);

      if (!success) {
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Invalid agent ID or API key'
        });
        return;
      }

      const agent = this.agentService.getAgent(id);

      res.json({
        success: true,
        agent: this.sanitizeAgent(agent!)
      });

    } catch (error) {
      if (error instanceof AgentLockedError) {
        res.status(429).json({
          error: 'TOO_MANY_REQUESTS',
          message: error.message
        });
        return;
      }
      throw error;
    }
  }

  private handleRotateKey(req: AuthenticatedRequest, res: Response): void {
    const agentId = req.agentId!;
    const { expiryDays } = req.body;

    const newKey = this.agentService.rotateApiKey(agentId, expiryDays);

    if (!newKey) {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to rotate key'
      });
      return;
    }

    const agent = this.agentService.getAgent(agentId);

    res.json({
      success: true,
      apiKey: newKey,
      expiresAt: agent?.expires_at
    });
  }

  private handleRevoke(req: AuthenticatedRequest, res: Response): void {
    const agentId = req.agentId!;

    const success = this.agentService.revokeApiKey(agentId);

    res.json({ success });
  }

  private handleGetSelf(req: AuthenticatedRequest, res: Response): void {
    const agent = req.agent;

    if (!agent) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }

    // Get last rotation from audit log
    const lastRotation = this.db.query(`
      SELECT created_at FROM audit_log
      WHERE agent_id = ? AND action IN ('key_rotated', 'agent_registered')
      ORDER BY created_at_epoch DESC
      LIMIT 1
    `).get(agent.id) as { created_at: string } | null;

    const now = Math.floor(Date.now() / 1000);
    const daysUntilExpiry = agent.expires_at_epoch
      ? Math.max(0, Math.ceil((agent.expires_at_epoch - now) / 86400))
      : null;

    res.json({
      agent: {
        id: agent.id,
        department: agent.department,
        permissions: agent.permissions,
        verified: agent.verified,
        last_seen_at: agent.last_seen_at,
        key_expires_at: agent.expires_at,
        key_last_rotated: lastRotation?.created_at ?? agent.created_at,
        days_until_expiry: daysUntilExpiry
      }
    });
  }

  /**
   * Remove sensitive fields from agent for API responses.
   */
  private sanitizeAgent(agent: any): any {
    const { api_key_prefix, api_key_hash, failed_attempts, locked_until_epoch, ...safe } = agent;
    return safe;
  }
}
```

---

## Step 4: Run Tests

```bash
bun test tests/routes/agent-routes.test.ts
```

---

## Step 5: Integrate with Worker Service

Add to worker service initialization:

```typescript
// In worker-service.ts or similar
import { AgentRoutes } from './http/routes/AgentRoutes.js';

// After creating app and agentService
const agentRoutes = new AgentRoutes(db, agentService);
agentRoutes.register(app);
```

---

## Step 6: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-2.4.spec.md`.

---

## Step 7: Commit

```bash
git add src/services/worker/http/routes/AgentRoutes.ts \
        tests/routes/agent-routes.test.ts \
        docs/plans/agents/specs/task-2.4.spec.md
git commit -m "feat: add agent API endpoints for registration, verification, rotation

- POST /api/agents/register: Create or update agent
- POST /api/agents/verify: Verify agent with API key
- POST /api/agents/rotate-key: Rotate API key (protected)
- POST /api/agents/revoke: Revoke API key (protected)
- GET /api/agents/me: Get own agent info (protected)

Part of #15"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-2.5-observation-agent-metadata.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 2.4 -->
## Context from Previous Agent

Task 2.4 is complete. Agent API endpoints are now available:

### Public Endpoints (rate limited)
- `POST /api/agents/register` - Register or update agent
- `POST /api/agents/verify` - Verify with API key

### Protected Endpoints (require auth)
- `POST /api/agents/rotate-key` - Get new API key
- `POST /api/agents/revoke` - Revoke current key
- `GET /api/agents/me` - Get own info

### Integration
```typescript
const agentRoutes = new AgentRoutes(db, agentService);
agentRoutes.register(app);
```

Your task is to update observation insertion to include agent metadata
(agent ID, department, visibility) when creating new observations.

Tests passing: `bun test tests/routes/agent-routes.test.ts`
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All tests pass
- [ ] Routes integrated with worker service
- [ ] Rate limiting applied
- [ ] Code committed
- [ ] Handoff comment added to task-2.5
