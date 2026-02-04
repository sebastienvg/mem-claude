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

## Test Cases
- [ ] Returns valid JSON with 200 status
- [ ] Contains timestamp field in ISO format
- [ ] Contains all agent metric fields
- [ ] Contains all auth metric fields
- [ ] Contains all alias metric fields
- [ ] Contains all observation metric fields
- [ ] All values are reasonable numbers (non-negative)
- [ ] Works with empty database
- [ ] Handles internal errors gracefully (500 response)
