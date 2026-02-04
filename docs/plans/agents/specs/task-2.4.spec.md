# Task 2.4 Specification: Agent API Endpoints

## Endpoints

### POST /api/agents/register (rate limited)
- [x] Accepts { id, department, permissions? }
- [x] Returns { success: true, agent, apiKey } for new agents
- [x] Returns { success: true, agent } for existing agents (no apiKey)
- [x] 400 for missing required fields
- [x] 400 for invalid agent ID format
- [x] Rate limited with authRateLimiter

### POST /api/agents/verify (rate limited)
- [x] Accepts { id, apiKey }
- [x] Returns { success: true, agent } on success
- [x] 400 for missing required fields
- [x] 401 on invalid credentials
- [x] 429 on agent locked
- [x] Rate limited with authRateLimiter

### POST /api/agents/rotate-key (protected)
- [x] Requires authentication (Bearer token)
- [x] Agent can only rotate own key
- [x] Accepts optional { expiryDays }
- [x] Returns { success: true, apiKey, expiresAt }
- [x] 401 without valid auth

### POST /api/agents/revoke (protected)
- [x] Requires authentication (Bearer token)
- [x] Agent can only revoke own key
- [x] Returns { success: true }
- [x] 401 without valid auth

### GET /api/agents/me (protected)
- [x] Requires authentication (Bearer token)
- [x] Returns agent info with key metadata
- [x] Includes days_until_expiry calculation
- [x] Includes key_last_rotated from audit log
- [x] 401 without valid auth

## Response Formats

### Success
```json
{
  "success": true,
  "agent": {
    "id": "user@host",
    "department": "engineering",
    "permissions": "read,write",
    "verified": true,
    "created_at": "2024-01-01T00:00:00.000Z",
    "last_seen_at": "2024-01-01T00:00:00.000Z"
  },
  "apiKey": "cm_..." // Only on registration of new agents
}
```

### Error
```json
{
  "error": "ERROR_CODE",
  "message": "Human readable message"
}
```

### Error Codes
- `BAD_REQUEST` - Missing required fields or validation error
- `INVALID_ID_FORMAT` - Agent ID doesn't match user@host pattern
- `UNAUTHORIZED` - Invalid credentials or missing auth
- `TOO_MANY_REQUESTS` - Agent locked or rate limit exceeded
- `INTERNAL_ERROR` - Server error

## Test Cases

### agent-routes.test.ts
- [x] register: Creates new agent with API key
- [x] register: Returns existing agent without new key
- [x] register: Returns 400 for missing id
- [x] register: Returns 400 for missing department
- [x] register: Returns 400 for invalid ID format
- [x] verify: Returns 200 with correct key
- [x] verify: Returns 401 with wrong key
- [x] verify: Returns 400 for missing fields
- [x] verify: Returns 429 for locked agent
- [x] rotate-key: Generates new key (authenticated)
- [x] rotate-key: Accepts custom expiryDays
- [x] rotate-key: Returns 401 without auth
- [x] revoke: Revokes key (authenticated)
- [x] revoke: Key no longer works after revocation
- [x] revoke: Returns 401 without auth
- [x] me: Returns agent info (authenticated)
- [x] me: Returns days_until_expiry
- [x] me: Returns 401 without auth

## Security Considerations

- Rate limiting prevents brute-force attacks
- API keys are hashed before storage
- Only key prefix exposed in logs/responses
- Agent locked after 5 failed attempts
- Keys expire after 90 days by default
- Sensitive fields stripped from agent responses
