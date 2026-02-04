# Task 2.3: Add Authentication Middleware with Rate Limiting

<!-- HANDOFF FROM TASK 2.2 -->
## Context from Previous Agent

Task 2.2 is complete. AgentService is now available:

```typescript
import { AgentService, AgentLockedError } from '../services/agents/AgentService.js';

const service = new AgentService(db);

// Register
const { agent, apiKey } = service.registerAgent({
  id: 'user@host',
  department: 'engineering'
});

// Lookup (O(1) via prefix)
const agent = service.findAgentByKey(apiKey);

// Verify
service.verifyAgent('user@host', apiKey);

// Rotate
const newKey = service.rotateApiKey('user@host');

// Revoke
service.revokeApiKey('user@host');

// Visibility check
service.canAccessObservation('user@host', obs);
```

Your task is to create Express middleware that:
1. Extracts Bearer token from Authorization header
2. Uses findAgentByKey() for O(1) lookup
3. Handles AgentLockedError with 429 response
4. Attaches agent to request for downstream handlers
5. Applies rate limiting to auth endpoints

Tests passing: `bun test tests/services/agents/agent-service.test.ts`
<!-- END HANDOFF -->

**Phase:** 2 - Multi-Agent Architecture
**Issue:** #15
**Depends On:** Task 2.2 (AgentService)
**Next Task:** `task-2.4-agent-api-endpoints.md`

---

## Objective

Create Express middleware for agent authentication with O(1) key lookup, rate limiting, and proper error handling for locked agents.

---

## Files to Create

| File | Type |
|------|------|
| `src/services/worker/http/middleware/auth.ts` | Implementation |
| `src/services/worker/http/middleware/rate-limit.ts` | Implementation |
| `tests/middleware/auth.test.ts` | Tests |
| `docs/plans/agents/specs/task-2.3.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-2.3.spec.md`:

```markdown
# Task 2.3 Specification: Authentication Middleware

## auth.ts

### createAuthMiddleware(agentService)
- [ ] Returns Express middleware function
- [ ] Extracts Authorization header
- [ ] Returns 401 if header missing or not Bearer
- [ ] Uses findAgentByKey for O(1 lookup
- [ ] Returns 401 if key invalid
- [ ] Returns 403 if agent not verified
- [ ] Returns 429 if agent locked (with retryAfter)
- [ ] Attaches agent to req.agent
- [ ] Attaches agentId to req.agentId
- [ ] Calls next() on success

### AuthenticatedRequest interface
- [ ] Extends Express Request
- [ ] agent?: Agent
- [ ] agentId?: string

## rate-limit.ts

### authRateLimiter
- [ ] 15 minute window
- [ ] 20 attempts per window
- [ ] Returns JSON error

### apiRateLimiter
- [ ] 1 minute window
- [ ] 100 requests per window
- [ ] Returns JSON error

## Test Cases

### auth.test.ts
- [ ] Returns 401 for missing Authorization header
- [ ] Returns 401 for non-Bearer token
- [ ] Returns 401 for invalid API key
- [ ] Returns 403 for unverified agent
- [ ] Returns 429 for locked agent
- [ ] Attaches agent to request on success
- [ ] Calls next() on success
```

---

## Step 2: Install Dependencies

```bash
npm install express-rate-limit
```

---

## Step 3: Write Failing Tests

Create `tests/middleware/auth.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/services/sqlite/migrations.js';
import { AgentService, AgentLockedError } from '../../src/services/agents/AgentService.js';
import { createAuthMiddleware, AuthenticatedRequest } from '../../src/services/worker/http/middleware/auth.js';
import type { Response, NextFunction } from 'express';

describe('Auth Middleware', () => {
  let db: Database;
  let agentService: AgentService;
  let middleware: ReturnType<typeof createAuthMiddleware>;
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let apiKey: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    agentService = new AgentService(db);
    middleware = createAuthMiddleware(agentService);

    // Register and verify a test agent
    const result = agentService.registerAgent({
      id: 'test@host',
      department: 'engineering'
    });
    apiKey = result.apiKey!;
    agentService.verifyAgent('test@host', apiKey);

    mockReq = {
      headers: {},
      ip: '127.0.0.1'
    };

    mockRes = {
      status: mock((code: number) => mockRes as Response),
      json: mock((data: any) => mockRes as Response)
    };

    mockNext = mock(() => {});
  });

  afterEach(() => {
    db.close();
  });

  it('should return 401 for missing Authorization header', () => {
    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'UNAUTHORIZED'
    }));
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 for non-Bearer token', () => {
    mockReq.headers = { authorization: 'Basic abc123' };

    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 for invalid API key', () => {
    mockReq.headers = { authorization: 'Bearer cm_invalidkey123456789012345' };

    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 403 for unverified agent', () => {
    // Register but don't verify
    const unverified = agentService.registerAgent({
      id: 'unverified@host',
      department: 'test'
    });

    mockReq.headers = { authorization: `Bearer ${unverified.apiKey}` };

    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'FORBIDDEN'
    }));
  });

  it('should attach agent to request on success', () => {
    mockReq.headers = { authorization: `Bearer ${apiKey}` };

    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect((mockReq as AuthenticatedRequest).agent).toBeTruthy();
    expect((mockReq as AuthenticatedRequest).agentId).toBe('test@host');
  });

  it('should return 429 for locked agent', () => {
    // Lock the agent by simulating failed attempts
    db.run(`
      UPDATE agents SET locked_until_epoch = ?
      WHERE id = 'test@host'
    `, [Math.floor(Date.now() / 1000) + 300]);

    mockReq.headers = { authorization: `Bearer ${apiKey}` };

    middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(429);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'TOO_MANY_REQUESTS'
    }));
  });
});
```

---

## Step 4: Implement

Create `src/services/worker/http/middleware/auth.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import { AgentService, AgentLockedError, Agent } from '../../../agents/AgentService.js';
import { logger } from '../../../../utils/logger.js';

export interface AuthenticatedRequest extends Request {
  agent?: Agent;
  agentId?: string;
}

/**
 * Create authentication middleware with O(1) key lookup.
 */
export function createAuthMiddleware(agentService: AgentService) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing or invalid Authorization header. Use: Bearer <api_key>'
      });
      return;
    }

    const apiKey = authHeader.slice(7); // Remove 'Bearer '

    try {
      // O(1) lookup by key prefix
      const agent = agentService.findAgentByKey(apiKey);

      if (!agent) {
        logger.warn('AUTH', 'Invalid API key attempt', { ip: req.ip });
        res.status(401).json({
          error: 'UNAUTHORIZED',
          message: 'Invalid API key'
        });
        return;
      }

      if (!agent.verified) {
        res.status(403).json({
          error: 'FORBIDDEN',
          message: 'Agent not verified. Call POST /api/agents/verify first.'
        });
        return;
      }

      // Success - attach agent to request
      req.agent = agent;
      req.agentId = agent.id;
      next();

    } catch (error) {
      if (error instanceof AgentLockedError) {
        const retryAfter = Math.ceil(
          (error.lockedUntil.getTime() - Date.now()) / 1000
        );

        res.status(429).json({
          error: 'TOO_MANY_REQUESTS',
          message: error.message,
          retryAfter
        });
        return;
      }

      logger.error('AUTH', 'Unexpected auth error', { error });
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Authentication failed'
      });
    }
  };
}

/**
 * Optional middleware for endpoints that accept but don't require auth.
 * Attaches agent if present, continues without error if not.
 */
export function createOptionalAuthMiddleware(agentService: AgentService) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No auth provided - continue without agent
      next();
      return;
    }

    const apiKey = authHeader.slice(7);

    try {
      const agent = agentService.findAgentByKey(apiKey);
      if (agent && agent.verified) {
        req.agent = agent;
        req.agentId = agent.id;
      }
    } catch {
      // Ignore auth errors for optional auth
    }

    next();
  };
}
```

Create `src/services/worker/http/middleware/rate-limit.ts`:

```typescript
import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for authentication endpoints.
 * More strict than general API limits.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per window
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Too many authentication attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * General API rate limiter.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Rate limit exceeded. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Stricter rate limiter for sensitive operations.
 */
export const sensitiveRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Rate limit exceeded for sensitive operation.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});
```

---

## Step 5: Run Tests (Should Pass)

```bash
bun test tests/middleware/auth.test.ts
```

---

## Step 6: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-2.3.spec.md`.

---

## Step 7: Commit

```bash
git add src/services/worker/http/middleware/auth.ts \
        src/services/worker/http/middleware/rate-limit.ts \
        tests/middleware/auth.test.ts \
        docs/plans/agents/specs/task-2.3.spec.md \
        package.json package-lock.json
git commit -m "feat: add auth middleware with O(1) lookup and rate limiting

- createAuthMiddleware() with O(1) key lookup
- Returns 401/403/429 appropriately
- Handles AgentLockedError with retry-after header
- authRateLimiter: 20 attempts per 15 minutes
- apiRateLimiter: 100 requests per minute

Part of #15"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-2.4-agent-api-endpoints.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 2.3 -->
## Context from Previous Agent

Task 2.3 is complete. Auth middleware is now available:

```typescript
import { createAuthMiddleware, AuthenticatedRequest } from './middleware/auth.js';
import { authRateLimiter, apiRateLimiter } from './middleware/rate-limit.js';

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
```

Your task is to create the agent API endpoints:
- POST /api/agents/register
- POST /api/agents/verify
- POST /api/agents/rotate-key
- POST /api/agents/revoke
- GET /api/agents/me (protected)

Tests passing: `bun test tests/middleware/auth.test.ts`
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All tests pass
- [ ] express-rate-limit installed
- [ ] Middleware handles all error cases
- [ ] Code committed
- [ ] Handoff comment added to task-2.4
