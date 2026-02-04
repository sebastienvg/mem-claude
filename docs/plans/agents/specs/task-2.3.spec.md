# Task 2.3 Specification: Authentication Middleware

**Created:** 2026-02-03
**Status:** COMPLETE

## auth.ts

### Interfaces

#### AuthenticatedRequest
- [x] Extends Express Request
- [x] agent?: Agent
- [x] agentId?: string

### createAuthMiddleware(agentService)
- [x] Returns Express middleware function (req, res, next) => void
- [x] Extracts Authorization header from request
- [x] Returns 401 if header missing
- [x] Returns 401 if header does not start with "Bearer "
- [x] Uses findAgentByKey for O(1) lookup
- [x] Returns 401 if key invalid (agent not found)
- [x] Returns 403 if agent not verified
- [x] Returns 429 if agent locked (AgentLockedError)
- [x] Includes retryAfter in 429 response
- [x] Attaches agent to req.agent on success
- [x] Attaches agentId to req.agentId on success
- [x] Calls next() on success
- [x] Logs invalid key attempts

### createOptionalAuthMiddleware(agentService)
- [x] Returns Express middleware function
- [x] Continues without error if no auth header
- [x] Attaches agent if valid auth provided
- [x] Ignores auth errors (for optional auth)

## rate-limit.ts

### authRateLimiter
- [x] 15 minute window (windowMs: 15 * 60 * 1000)
- [x] 20 attempts per window (max: 20)
- [x] Returns JSON error with TOO_MANY_REQUESTS
- [x] Enables standardHeaders
- [x] Disables legacyHeaders

### apiRateLimiter
- [x] 1 minute window (windowMs: 60 * 1000)
- [x] 100 requests per window (max: 100)
- [x] Returns JSON error with TOO_MANY_REQUESTS
- [x] Enables standardHeaders
- [x] Disables legacyHeaders

### sensitiveRateLimiter
- [x] 1 minute window (windowMs: 60 * 1000)
- [x] 10 requests per window (max: 10)
- [x] Returns JSON error with TOO_MANY_REQUESTS
- [x] Enables standardHeaders
- [x] Disables legacyHeaders

## Test Cases

### auth.test.ts

#### createAuthMiddleware tests
- [x] Returns 401 for missing Authorization header
- [x] Returns 401 for non-Bearer token (e.g., "Basic abc123")
- [x] Returns 401 for invalid API key
- [x] Returns 403 for unverified agent
- [x] Returns 429 for locked agent
- [x] Includes retryAfter in 429 response body
- [x] Attaches agent to request on success
- [x] Attaches agentId to request on success
- [x] Calls next() on success
- [x] Does not call next() on error

#### createOptionalAuthMiddleware tests
- [x] Calls next() without auth header
- [x] Does not attach agent without auth header
- [x] Attaches agent with valid auth
- [x] Calls next() even with invalid auth

## Design Notes

### Authorization Header Format
- Scheme: Bearer
- Format: `Authorization: Bearer cm_<base64url>`
- Example: `Authorization: Bearer cm_ABC123xyz...`

### Error Response Format
```json
{
  "error": "ERROR_CODE",
  "message": "Human readable message",
  "retryAfter": 300  // Only for 429
}
```

### Error Codes
- `UNAUTHORIZED` (401): Missing/invalid auth header or API key
- `FORBIDDEN` (403): Agent not verified
- `TOO_MANY_REQUESTS` (429): Agent locked or rate limited

### Rate Limiting Strategy
- Auth endpoints: Stricter limits (20/15min) to prevent brute force
- General API: Moderate limits (100/min) for normal usage
- Sensitive ops: Strict limits (10/min) for key rotation, revocation

## Implementation Notes

### File Locations
- Auth middleware: `/Users/seb/AI/claude-mem/src/services/worker/http/middleware/auth.ts`
- Rate limiters: `/Users/seb/AI/claude-mem/src/services/worker/http/middleware/rate-limit.ts`
- Index: `/Users/seb/AI/claude-mem/src/services/worker/http/middleware/index.ts`
- Tests: `/Users/seb/AI/claude-mem/tests/middleware/auth.test.ts`

### Dependencies
- express (Request, Response, NextFunction types)
- express-rate-limit (rateLimit function)
- AgentService from services/agents
- AgentLockedError from services/agents
- logger from utils

### Test Results
- 19 tests passing
- 45 expect() calls
- All spec items verified
