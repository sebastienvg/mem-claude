<!-- HANDOFF FROM TASK 4.3 -->
## Context from Previous Agent

Task 4.3 is complete. Metrics endpoint available:

```bash
curl http://localhost:37777/api/metrics
```

Returns JSON with agents, auth, aliases, and observations stats.

Files created:
- `src/services/worker/http/routes/MetricsRoutes.ts` - Implementation
- `tests/routes/metrics.test.ts` - Unit tests (22 tests passing)
- `docs/plans/agents/specs/task-4.3.spec.md` - Specification

Your task is to enhance the /api/agents/me endpoint with more key metadata.
<!-- END HANDOFF -->

# Task 4.4: Enhanced Agent Self-Info Endpoint (Optional)

**Phase:** 4 - Polish & Maintenance (Optional)
**Issue:** #15
**Depends On:** Task 4.3
**Next Task:** None (Final Task)

---

## Status: OPTIONAL

This task enhances the existing /api/agents/me endpoint and is not required for release.

---

## Objective

Enhance the `/api/agents/me` endpoint to include comprehensive key metadata, helping agents understand their authentication status and take action before key expiration.

---

## Current vs Enhanced

### Current Response

```json
{
  "agent": {
    "id": "seb@laptop",
    "department": "engineering",
    "permissions": "read,write",
    "verified": true
  }
}
```

### Enhanced Response

```json
{
  "agent": {
    "id": "seb@laptop",
    "department": "engineering",
    "permissions": "read,write",
    "verified": true,
    "last_seen_at": "2026-02-03T12:00:00Z",
    "key_expires_at": "2026-05-03T12:00:00Z",
    "key_last_rotated": "2026-02-01T10:30:00Z",
    "days_until_expiry": 89,
    "should_rotate": false,
    "rotation_recommended_at": "2026-04-18T12:00:00Z"
  }
}
```

---

## Specification

Create `docs/plans/agents/specs/task-4.4.spec.md`:

```markdown
# Task 4.4 Specification: Enhanced Agent Self-Info

## Enhanced Fields

### Key Metadata
- [ ] key_expires_at: ISO timestamp of key expiration
- [ ] key_last_rotated: ISO timestamp of last rotation
- [ ] days_until_expiry: Integer days until expiration
- [ ] should_rotate: Boolean, true if <15 days remaining
- [ ] rotation_recommended_at: ISO timestamp (15 days before expiry)

### Activity Metadata
- [ ] last_seen_at: Last activity timestamp
- [ ] created_at: Agent registration timestamp

## Test Cases
- [ ] Returns all enhanced fields
- [ ] days_until_expiry is correct
- [ ] should_rotate true when <15 days
- [ ] should_rotate false when >=15 days
- [ ] Works for agents without expiration
```

---

## Implementation

Update `/api/agents/me` handler in `AgentRoutes.ts`:

```typescript
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

  // Calculate expiry info
  let daysUntilExpiry: number | null = null;
  let shouldRotate = false;
  let rotationRecommendedAt: string | null = null;

  if (agent.expires_at_epoch) {
    daysUntilExpiry = Math.max(0, Math.ceil((agent.expires_at_epoch - now) / 86400));
    shouldRotate = daysUntilExpiry < 15;

    // Recommend rotation 15 days before expiry
    const recommendedEpoch = agent.expires_at_epoch - (15 * 86400);
    rotationRecommendedAt = new Date(recommendedEpoch * 1000).toISOString();
  }

  res.json({
    agent: {
      id: agent.id,
      department: agent.department,
      permissions: agent.permissions,
      verified: agent.verified,
      created_at: agent.created_at,
      last_seen_at: agent.last_seen_at,
      key_expires_at: agent.expires_at,
      key_last_rotated: lastRotation?.created_at ?? agent.created_at,
      days_until_expiry: daysUntilExpiry,
      should_rotate: shouldRotate,
      rotation_recommended_at: rotationRecommendedAt
    }
  });
}
```

---

## Usage Examples

### Check if rotation needed

```typescript
const res = await fetch('http://localhost:37777/api/agents/me', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
});
const { agent } = await res.json();

if (agent.should_rotate) {
  console.log(`Warning: Key expires in ${agent.days_until_expiry} days`);
  console.log(`Rotate before: ${agent.key_expires_at}`);
  // Trigger rotation
  await fetch('http://localhost:37777/api/agents/rotate-key', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
}
```

### Monitor key health

```bash
# Cron job to check key health
curl -s -H "Authorization: Bearer $API_KEY" \
  http://localhost:37777/api/agents/me | \
  jq 'if .agent.should_rotate then "ROTATE NOW: \(.agent.days_until_expiry) days left" else "OK: \(.agent.days_until_expiry) days left" end'
```

---

## Tests

```typescript
describe('Enhanced /api/agents/me', () => {
  it('should include all enhanced fields', async () => {
    const res = await request(app)
      .get('/api/agents/me')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.body.agent.days_until_expiry).toBeDefined();
    expect(res.body.agent.should_rotate).toBeDefined();
    expect(res.body.agent.rotation_recommended_at).toBeDefined();
  });

  it('should set should_rotate true when expiry is near', async () => {
    // Set expiry to 10 days from now
    db.run(`UPDATE agents SET expires_at_epoch = ? WHERE id = 'test@host'`, [
      Math.floor(Date.now() / 1000) + (10 * 86400)
    ]);

    const res = await request(app)
      .get('/api/agents/me')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.body.agent.should_rotate).toBe(true);
    expect(res.body.agent.days_until_expiry).toBe(10);
  });

  it('should handle agents without expiration', async () => {
    db.run(`UPDATE agents SET expires_at_epoch = NULL WHERE id = 'test@host'`);

    const res = await request(app)
      .get('/api/agents/me')
      .set('Authorization', `Bearer ${apiKey}`);

    expect(res.body.agent.days_until_expiry).toBeNull();
    expect(res.body.agent.should_rotate).toBe(false);
  });
});
```

---

## Commit

```bash
git commit -m "feat: enhance /api/agents/me with key expiry metadata

Adds:
- days_until_expiry: Days until key expires
- should_rotate: True if <15 days remaining
- rotation_recommended_at: Suggested rotation date
- key_last_rotated: When key was last rotated

Helps agents proactively manage key rotation.

Part of #15"
```

---

## Phase 4 Complete!

This concludes all optional polish tasks. The implementation is now complete.

---

## Final Summary

### Completed Tasks

**Phase 1: Git Repository Identification**
- [x] 1.1: Git Remote URL Utility
- [x] 1.2: Update getProjectName
- [x] 1.3: Project Aliases Migration
- [x] 1.4: Project Alias Service
- [x] 1.5: Session Alias Registration
- [x] 1.6: Query Alias Support
- [x] 1.7: Migration CLI

**Phase 2: Multi-Agent Architecture**
- [x] 2.1: Agents Table Migration
- [x] 2.2: Agent Service
- [x] 2.3: Auth Middleware
- [x] 2.4: Agent API Endpoints
- [x] 2.5: Observation Metadata
- [x] 2.6: Visibility Enforcement

**Phase 3: Integration & Testing**
- [x] 3.1: E2E Tests
- [x] 3.2: Settings Integration
- [x] 3.3: Documentation
- [x] 3.4: Final Review

**Phase 4: Polish & Maintenance (Optional)**
- [x] 4.1: Prefix Collisions
- [x] 4.2: Maintenance CLI
- [x] 4.3: Metrics Endpoint
- [x] 4.4: Agent Self-Info

---

## Acceptance Criteria

- [ ] Enhanced response includes all new fields
- [ ] should_rotate logic correct
- [ ] Tests cover edge cases
- [ ] Committed
- [ ] Implementation complete!
