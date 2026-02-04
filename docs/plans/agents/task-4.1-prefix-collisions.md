<!-- HANDOFF FROM TASK 3.4 -->
## Phase 3 Complete - All Core Features Implemented!

### Summary

**Phase 1: Git Repository Identification**
- getProjectName() returns git remote ID (e.g., `github.com/user/repo`)
- Automatic alias registration linking folder names to git remotes
- Query expansion with aliases for historical data access
- CLI for alias management: `claude-mem alias list|add|cleanup|count`

**Phase 2: Multi-Agent Architecture**
- Agents table with O(1) key lookup via prefix indexing
- Brute-force protection (5 attempts -> 5 min lockout, configurable)
- Visibility enforcement (private, department, project, public)
- Full API lifecycle: register -> verify -> rotate-key -> revoke
- 90-day key expiration (configurable)
- Comprehensive audit logging

**Phase 3: Integration & Testing**
- 22 E2E tests for project identity and multi-agent features
- 29 settings integration tests for 5 new configuration options
- Documentation complete: multi-agent.mdx, api-reference.mdx, configuration updates
- Final review passed with 267 Phase 3 related tests passing

### New Settings Added
| Setting | Default | Description |
|---------|---------|-------------|
| `CLAUDE_MEM_GIT_REMOTE_PREFERENCE` | `origin,upstream` | Git remote priority order |
| `CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY` | `project` | Default observation visibility |
| `CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS` | `90` | API key expiration days |
| `CLAUDE_MEM_AGENT_LOCKOUT_DURATION` | `300` | Lockout seconds after failed auth |
| `CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS` | `5` | Attempts before lockout |

### Database Migrations
- Migration 21: agents table, audit_log, visibility columns on observations/summaries
- Migration 22: project_aliases table for migration compatibility

### What's Next (Phase 4 - Optional)

Phase 4 tasks are polish/improvement items not required for release:
- 4.1: Handle prefix collisions (rare edge case, ~1 in 2^48 probability)
- 4.2: Maintenance CLI commands
- 4.3: Metrics endpoint
- 4.4: Agent self-info endpoint

These improve operational readiness but are not blockers.
<!-- END HANDOFF -->

# Task 4.1: Handle Prefix Collisions (Optional)

**Phase:** 4 - Polish & Maintenance (Optional)
**Issue:** #15
**Depends On:** Phase 3 complete
**Next Task:** `task-4.2-maintenance-cli.md`

---

## Status: OPTIONAL

This task addresses a rare edge case and is not required for release.

---

## Objective

Handle the theoretical case where two API keys share the same 12-character prefix but have different full hashes. This is extremely unlikely (~1 in 2^48) but should be handled gracefully.

---

## Problem Analysis

### Current Behavior

The `findAgentByKey()` function:
1. Looks up agent by `api_key_prefix` (first 12 chars)
2. Verifies full `api_key_hash`
3. If hash doesn't match, increments `failed_attempts`

### Edge Case

If two agents have keys with the same prefix but different hashes:
- Agent A: `cm_ABCDEFGHIJKL...` (prefix: `cm_ABCDEFGHIJ`)
- Agent B: `cm_ABCDEFGHIJMN...` (same prefix, different suffix)

Using Agent B's key would find Agent A's record (by prefix), fail hash verification, and incorrectly increment Agent A's `failed_attempts`.

### Probability

- 12-char base64url = ~72 bits of entropy
- Collision probability ≈ 1 in 2^48 ≈ 1 in 281 trillion
- Acceptable for <10K agents

---

## Solutions

### Option A: Accept Risk (Recommended for now)

Log a warning when prefix matches but hash doesn't:

```typescript
if (candidate.api_key_hash !== hash) {
  // Check if this might be a prefix collision
  logger.warn('AGENTS', 'API key prefix collision detected', {
    candidateId: candidate.id,
    note: 'This may indicate a rare prefix collision or an attack'
  });
  // ... continue with failed attempt handling
}
```

### Option B: Composite Unique Index

Add a composite index that includes both prefix and hash:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_key_composite
ON agents(api_key_prefix, api_key_hash);
```

This ensures the database enforces uniqueness.

### Option C: Query by Both

Modify lookup to query by both prefix and hash:

```typescript
const candidate = this.db.query(`
  SELECT * FROM agents
  WHERE api_key_prefix = ? AND api_key_hash = ?
`).get(prefix, hash) as any;
```

This is still O(1) with the composite index but eliminates false matches.

---

## Implementation (Option A)

If implementing, add warning logging:

```typescript
// In findAgentByKey()

if (candidate.api_key_hash !== hash) {
  // This is either a wrong key or a very rare prefix collision
  const now = Math.floor(Date.now() / 1000);

  // Log for monitoring
  logger.warn('AGENTS', 'API key verification failed', {
    candidateId: candidate.id,
    prefixMatch: true,
    hashMatch: false,
    note: 'Could be wrong key or rare prefix collision (~1 in 2^48)'
  });

  // ... existing failed attempt handling
}
```

---

## Specification

Create `docs/plans/agents/specs/task-4.1.spec.md`:

```markdown
# Task 4.1 Specification: Prefix Collision Handling

## Requirements

- [ ] Add warning log when prefix matches but hash doesn't
- [ ] Document collision probability
- [ ] Consider composite index for high-scale deployments

## Test Cases

- [ ] Logs warning on prefix match with hash mismatch
- [ ] Still correctly handles failed attempts
```

---

## Decision

**Recommendation:** Implement Option A (logging) for now. Add Option B/C if the system scales beyond 10K agents.

---

## Commit (if implemented)

```bash
git commit -m "chore: add warning logging for potential API key prefix collisions

Logs when prefix matches but hash doesn't - indicates either wrong key
or extremely rare prefix collision (~1 in 2^48 probability).

Part of #15"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-4.2-maintenance-cli.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 4.1 -->
## Context from Previous Agent

Task 4.1 is complete (or skipped as acceptable risk).

**Prefix collision handling:**
- Current: Log warning on prefix match with hash mismatch
- Probability: ~1 in 2^48 (acceptable for <10K agents)
- Future: Add composite index if scale increases

Your task is to add maintenance CLI commands for cleanup operations.
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] Decision documented
- [ ] Warning logging added (if implementing Option A)
- [ ] Handoff comment added
