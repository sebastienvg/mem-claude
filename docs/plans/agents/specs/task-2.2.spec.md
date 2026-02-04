# Task 2.2 Specification: Agent Service

**Created:** 2026-02-03
**Status:** COMPLETE

## Constants

- [x] KEY_PREFIX_LENGTH = 12
- [x] DEFAULT_KEY_EXPIRY_DAYS = 90
- [x] MAX_FAILED_ATTEMPTS = 5
- [x] LOCKOUT_DURATION_SECONDS = 300 (5 minutes)
- [x] AGENT_ID_PATTERN = /^[\w.-]+@[\w.-]+$/

## Error Classes

### errors.ts
- [x] AgentIdFormatError: Invalid agent ID format
- [x] AgentLockedError: Agent temporarily locked (includes lockedUntil date)

## AgentService Class

### Constructor
- [x] Accepts Database instance

### registerAgent(reg: { id, department, permissions? })
- [x] Validates agent ID format (user@host pattern)
- [x] Rejects IDs with SQL injection characters (; -- ')
- [x] Updates last_seen_at if agent exists (no new key)
- [x] Generates new API key for new agents (cm_ prefix)
- [x] Sets 90-day expiration by default
- [x] Returns { agent, apiKey? }
- [x] Creates audit log entry

### getAgent(id)
- [x] Returns agent by ID or null
- [x] Converts verified field to boolean

### findAgentByKey(apiKey)
- [x] O(1) lookup via api_key_prefix index
- [x] Checks lockout before hash verification
- [x] Throws AgentLockedError if locked
- [x] Verifies full SHA-256 hash
- [x] Checks key expiration
- [x] Increments failed_attempts on hash mismatch
- [x] Locks agent after MAX_FAILED_ATTEMPTS failures
- [x] Resets failed_attempts on successful verification
- [x] Returns Agent or null

### verifyAgent(id, apiKey)
- [x] Uses findAgentByKey for lookup
- [x] Sets verified = 1 on success
- [x] Creates audit log entry
- [x] Returns boolean

### rotateApiKey(id, expiryDays?)
- [x] Returns null if agent doesn't exist
- [x] Generates new API key
- [x] Updates api_key_prefix and api_key_hash
- [x] Resets verified to 0
- [x] Sets new expiration date
- [x] Resets failed_attempts to 0
- [x] Creates audit log entry
- [x] Returns new API key string

### revokeApiKey(id)
- [x] Returns false if agent doesn't exist
- [x] Sets api_key_prefix and api_key_hash to NULL
- [x] Resets verified to 0
- [x] Creates audit log entry
- [x] Returns true on success

### hasPermission(agentId, permission)
- [x] Returns false if agent doesn't exist
- [x] Parses comma-separated permissions string
- [x] Returns boolean for 'read' or 'write'

### canAccessObservation(agentId, observation)
- [x] Returns false if agent doesn't exist
- [x] Checks read permission first
- [x] public visibility: always true
- [x] project visibility: true (currently global)
- [x] department visibility: same department only
- [x] private visibility: same agent only

## Test Cases

### agent-service.test.ts

#### registerAgent tests
- [x] Creates new agent with API key (cm_ prefix)
- [x] Updates existing agent without generating new key
- [x] Rejects invalid ID format (missing @)
- [x] Rejects SQL injection attempts

#### findAgentByKey tests
- [x] Finds agent by valid key (O(1) lookup)
- [x] Returns null for invalid key
- [x] Returns null for expired key
- [x] Throws AgentLockedError for locked agent
- [x] Locks agent after 5 failed attempts

#### verifyAgent tests
- [x] Sets verified flag on success
- [x] Returns false for wrong key
- [x] Creates audit log entry

#### rotateApiKey tests
- [x] Generates new key different from original
- [x] Invalidates old key
- [x] Resets verified flag

#### revokeApiKey tests
- [x] Revokes key successfully
- [x] Returns false for non-existent agent

#### canAccessObservation tests
- [x] Allows public visibility to anyone
- [x] Allows project visibility to anyone
- [x] Restricts department visibility to same department
- [x] Restricts private visibility to owner only

## Design Notes

### API Key Format
- Prefix: `cm_` (claude-mem)
- Body: 24 random bytes encoded as base64url
- Total: ~35 characters
- Example: `cm_ABC123xyz...`

### Hash Format
- Algorithm: SHA-256
- Format: `sha256:<hex_digest>`
- Storage: Full hash in api_key_hash column

### O(1) Lookup Strategy
1. Extract first 12 characters of API key
2. Index lookup by api_key_prefix (B-tree, O(1))
3. Verify full hash of candidate
4. Handle prefix collisions gracefully

### Brute-Force Protection
- Counter: `failed_attempts` incremented on hash mismatch
- Threshold: 5 failed attempts
- Lockout: 300 seconds (5 minutes)
- Reset: Counter resets on successful verification

## Implementation Notes

### File Locations
- Service: `/Users/seb/AI/claude-mem/src/services/agents/AgentService.ts`
- Errors: `/Users/seb/AI/claude-mem/src/services/agents/errors.ts`
- Tests: `/Users/seb/AI/claude-mem/tests/services/agents/agent-service.test.ts`

### Dependencies
- bun:sqlite Database
- crypto (createHash, randomBytes)
- logger from utils

### Test Results
- 40 tests passing
- 64 expect() calls
- All spec items verified
