# Task 4.1 Specification: Prefix Collision Handling

## Overview

Handle the theoretical case where two API keys share the same 12-character prefix but have different full hashes. This is extremely unlikely (~1 in 2^48) but should be handled gracefully with appropriate logging.

## Implementation: Option A (Warning Logging)

Add warning log when prefix matches but hash verification fails. This provides visibility into potential collision scenarios without requiring schema changes.

## Requirements

- [x] Add warning log when prefix matches but hash doesn't match
- [x] Log includes candidate agent ID and descriptive note
- [x] Document collision probability (~1 in 2^48)
- [x] Existing failed attempt handling preserved
- [x] Audit log entry still created for verify_failed

## Test Cases

- [x] Logs warning on prefix match with hash mismatch
- [x] Still correctly handles failed attempts
- [x] Still creates audit log entry
- [x] Existing findAgentByKey tests still pass

## Code Location

**File:** `src/services/agents/AgentService.ts`
**Function:** `findAgentByKey()`

## Warning Log Details

```typescript
logger.warn('DB', 'API key prefix match but hash mismatch', {
  candidateId: candidate.id,
  note: 'Could be wrong key or rare prefix collision (~1 in 2^48 probability)'
});
```

## Probability Analysis

- 12-char base64url prefix = ~72 bits of entropy
- Collision probability: ~1 in 2^48 = ~1 in 281 trillion
- Acceptable risk for deployments with <10K agents
- Future consideration: Add composite index if scale increases beyond 10K agents

## Future Options (Not Implemented)

### Option B: Composite Unique Index
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_key_composite
ON agents(api_key_prefix, api_key_hash);
```

### Option C: Query by Both
```typescript
const candidate = this.db.query(`
  SELECT * FROM agents
  WHERE api_key_prefix = ? AND api_key_hash = ?
`).get(prefix, hash);
```

These options can be added if the system scales beyond 10K agents.
