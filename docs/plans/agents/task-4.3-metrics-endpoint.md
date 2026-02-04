<!-- HANDOFF FROM TASK 4.2 -->
## Context from Previous Agent

Task 4.2 is complete. Maintenance CLI is available:

```bash
# Preview cleanup
bun scripts/maintenance-cli.ts --dry-run

# Actual cleanup
bun scripts/maintenance-cli.ts

# Custom thresholds
bun scripts/maintenance-cli.ts --alias-max-age=180 --audit-max-age=30
```

Files created:
- `src/cli/commands/maintenance.ts` - Core maintenance functions
- `scripts/maintenance-cli.ts` - CLI entry point
- `tests/cli/maintenance-command.test.ts` - Unit tests (11 tests passing)
- `docs/plans/agents/specs/task-4.2.spec.md` - Specification

The maintenance CLI can be used to collect the same stats needed for the /api/metrics endpoint.
Your task is to add a /api/metrics endpoint for monitoring.
<!-- END HANDOFF -->

# Task 4.3: Add Metrics Endpoint (Optional)

**Phase:** 4 - Polish & Maintenance (Optional)
**Issue:** #15
**Depends On:** Task 4.2
**Next Task:** `task-4.4-agent-self-info.md`

---

## Status: OPTIONAL

This task adds monitoring capabilities and is not required for release.

---

## Objective

Create a `/api/metrics` endpoint that exposes system health and usage statistics for monitoring dashboards.

---

## Files to Create

| File | Type |
|------|------|
| `src/services/worker/http/routes/MetricsRoutes.ts` | Implementation |
| `tests/routes/metrics.test.ts` | Tests |
| `docs/plans/agents/specs/task-4.3.spec.md` | Specification |

---

## Specification

Create `docs/plans/agents/specs/task-4.3.spec.md`:

```markdown
# Task 4.3 Specification: Metrics Endpoint

## Endpoint

### GET /api/metrics
- [ ] Returns JSON with system metrics
- [ ] No authentication required (internal use)
- [ ] Suitable for Prometheus/Grafana integration

## Metrics Categories

### Agent Metrics
- [ ] total: Total registered agents
- [ ] verified: Verified agents
- [ ] locked: Currently locked agents
- [ ] active_24h: Active in last 24 hours

### Auth Metrics
- [ ] failed_attempts_1h: Failed auth attempts in last hour
- [ ] lockouts_24h: Lockouts in last 24 hours

### Alias Metrics
- [ ] total: Total aliases
- [ ] projects_with_aliases: Unique projects with aliases
- [ ] max_per_project: Maximum aliases for any project
- [ ] avg_per_project: Average aliases per project

### Observation Metrics
- [ ] total: Total observations
- [ ] by_visibility: Breakdown by visibility level

## Response Format
```json
{
  "timestamp": "2026-02-03T12:00:00Z",
  "agents": { ... },
  "auth": { ... },
  "aliases": { ... },
  "observations": { ... }
}
```

## Test Cases
- [ ] Returns valid JSON
- [ ] All metric fields present
- [ ] Values are reasonable numbers
```

---

## Implementation

Create `src/services/worker/http/routes/MetricsRoutes.ts`:

```typescript
import { Express, Request, Response } from 'express';
import { Database } from 'bun:sqlite';

export class MetricsRoutes {
  constructor(private db: Database) {}

  register(app: Express): void {
    app.get('/api/metrics', this.handleMetrics.bind(this));
  }

  private handleMetrics(_req: Request, res: Response): void {
    try {
      const metrics = this.collectMetrics();
      res.json(metrics);
    } catch (error) {
      res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'Failed to collect metrics'
      });
    }
  }

  private collectMetrics(): object {
    const now = Math.floor(Date.now() / 1000);
    const oneDayAgo = now - 86400;
    const oneHourAgo = now - 3600;

    // Agent metrics
    const totalAgents = this.count('SELECT COUNT(*) FROM agents');
    const verifiedAgents = this.count('SELECT COUNT(*) FROM agents WHERE verified = 1');
    const lockedAgents = this.count(
      'SELECT COUNT(*) FROM agents WHERE locked_until_epoch > ?',
      [now]
    );
    const activeAgents24h = this.count(
      'SELECT COUNT(*) FROM agents WHERE last_seen_at_epoch > ?',
      [oneDayAgo]
    );

    // Auth metrics
    const failedAttempts1h = this.count(
      "SELECT COUNT(*) FROM audit_log WHERE action = 'verify_failed' AND created_at_epoch > ?",
      [oneHourAgo]
    );
    const lockouts24h = this.count(
      "SELECT COUNT(*) FROM audit_log WHERE action = 'agent_locked' AND created_at_epoch > ?",
      [oneDayAgo]
    );

    // Alias metrics
    const totalAliases = this.count('SELECT COUNT(*) FROM project_aliases');
    const aliasStats = this.db.query(`
      SELECT
        COUNT(DISTINCT new_project) as projects_with_aliases,
        MAX(alias_count) as max_aliases_per_project,
        AVG(alias_count) as avg_aliases_per_project
      FROM (
        SELECT new_project, COUNT(*) as alias_count
        FROM project_aliases
        GROUP BY new_project
      )
    `).get() as any;

    // Observation metrics
    const totalObservations = this.count('SELECT COUNT(*) FROM observations');
    const observationsByVisibility = this.db.query(`
      SELECT visibility, COUNT(*) as count
      FROM observations
      GROUP BY visibility
    `).all();

    return {
      timestamp: new Date().toISOString(),
      agents: {
        total: totalAgents,
        verified: verifiedAgents,
        locked: lockedAgents,
        active_24h: activeAgents24h
      },
      auth: {
        failed_attempts_1h: failedAttempts1h,
        lockouts_24h: lockouts24h
      },
      aliases: {
        total: totalAliases,
        projects_with_aliases: aliasStats?.projects_with_aliases ?? 0,
        max_per_project: aliasStats?.max_aliases_per_project ?? 0,
        avg_per_project: Math.round((aliasStats?.avg_aliases_per_project ?? 0) * 10) / 10
      },
      observations: {
        total: totalObservations,
        by_visibility: observationsByVisibility
      }
    };
  }

  private count(sql: string, params: any[] = []): number {
    const result = this.db.query(sql).get(...params) as { 'COUNT(*)': number };
    return result['COUNT(*)'];
  }
}
```

---

## Integration

Add to worker service:

```typescript
import { MetricsRoutes } from './http/routes/MetricsRoutes.js';

const metricsRoutes = new MetricsRoutes(db);
metricsRoutes.register(app);
```

---

## Example Response

```json
{
  "timestamp": "2026-02-03T12:00:00Z",
  "agents": {
    "total": 15,
    "verified": 12,
    "locked": 1,
    "active_24h": 8
  },
  "auth": {
    "failed_attempts_1h": 3,
    "lockouts_24h": 1
  },
  "aliases": {
    "total": 42,
    "projects_with_aliases": 8,
    "max_per_project": 12,
    "avg_per_project": 5.2
  },
  "observations": {
    "total": 1523,
    "by_visibility": [
      {"visibility": "project", "count": 1200},
      {"visibility": "department", "count": 280},
      {"visibility": "private", "count": 43}
    ]
  }
}
```

---

## Prometheus Integration (Future)

For Prometheus scraping, add a `/metrics/prometheus` endpoint:

```typescript
app.get('/metrics/prometheus', (req, res) => {
  const metrics = this.collectMetrics();
  const lines = [
    `# HELP claude_mem_agents_total Total registered agents`,
    `# TYPE claude_mem_agents_total gauge`,
    `claude_mem_agents_total ${metrics.agents.total}`,
    // ... more metrics
  ];
  res.set('Content-Type', 'text/plain');
  res.send(lines.join('\n'));
});
```

---

## Tests

```typescript
describe('Metrics Endpoint', () => {
  it('should return valid metrics JSON', async () => {
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.body.timestamp).toBeTruthy();
    expect(typeof res.body.agents.total).toBe('number');
  });
});
```

---

## Commit

```bash
git commit -m "feat: add /api/metrics endpoint for monitoring

Returns JSON with:
- Agent stats (total, verified, locked, active)
- Auth stats (failed attempts, lockouts)
- Alias stats (total, per-project averages)
- Observation stats (total, by visibility)

Part of #15"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-4.4-agent-self-info.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 4.3 -->
## Context from Previous Agent

Task 4.3 is complete. Metrics endpoint available:

```bash
curl http://localhost:37777/api/metrics
```

Returns JSON with agents, auth, aliases, and observations stats.

Your task is to enhance the /api/agents/me endpoint with more key metadata.
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] Endpoint returns valid JSON
- [ ] All metric categories present
- [ ] Values are correct numbers
- [ ] No authentication required
- [ ] Handoff comment added
