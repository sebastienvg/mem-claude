# Task 3.3: Documentation Updates

<!-- HANDOFF FROM TASK 3.2 -->
## Context from Previous Agent

Task 3.2 is complete. Settings are now configurable:

### New Settings in ~/.claude-mem/settings.json

```json
{
  "CLAUDE_MEM_GIT_REMOTE_PREFERENCE": "origin,upstream",
  "CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY": "project",
  "CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS": "90",
  "CLAUDE_MEM_AGENT_LOCKOUT_DURATION": "300",
  "CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS": "5"
}
```

### Helper Functions (src/shared/settings-helpers.ts)
- `getGitRemotePreference()`: Returns string[] of remote names
- `getDefaultVisibility()`: Returns visibility enum (private|department|project|public)
- `getAgentKeyExpiryDays()`: Returns number of days
- `getLockoutDuration()`: Returns seconds as number
- `getMaxFailedAttempts()`: Returns number

### Integration Points
- AgentService uses settings for key expiry, lockout, max attempts
- git-remote.ts uses settings for remote preference

Tests passing: `bun test tests/shared/settings-new-features.test.ts` (29 tests)
<!-- END HANDOFF -->

**Phase:** 3 - Integration & Testing
**Issue:** #14, #15
**Depends On:** Task 3.2 (settings)
**Next Task:** `task-3.4-final-review.md`

---

## Objective

Update documentation to cover the new features: git-based project identification, multi-agent architecture, API endpoints, and security considerations.

---

## Files to Modify/Create

| File | Type |
|------|------|
| `docs/public/configuration.mdx` | Modify |
| `docs/public/multi-agent.mdx` | Create |
| `docs/public/api-reference.mdx` | Create/Modify |
| `CLAUDE.md` | Modify |
| `docs/plans/agents/specs/task-3.3.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-3.3.spec.md`:

```markdown
# Task 3.3 Specification: Documentation Updates

## Configuration Documentation
- [ ] Document new settings with descriptions
- [ ] Include examples for each setting
- [ ] Note default values

## Multi-Agent Documentation (New Page)
- [ ] Overview of multi-agent architecture
- [ ] Agent lifecycle (register → verify → use → rotate/revoke)
- [ ] Visibility levels explained
- [ ] Security best practices
- [ ] API key management

## API Reference
- [ ] POST /api/agents/register
- [ ] POST /api/agents/verify
- [ ] POST /api/agents/rotate-key
- [ ] POST /api/agents/revoke
- [ ] GET /api/agents/me
- [ ] Request/response examples
- [ ] Error codes

## Security Section
- [ ] API key security warning
- [ ] Brute-force protection explained
- [ ] Key expiration and rotation
- [ ] Visibility implications

## CLAUDE.md Updates
- [ ] Mention multi-agent support
- [ ] Reference new documentation
```

---

## Step 2: Update Configuration Documentation

Modify `docs/public/configuration.mdx`:

```mdx
---
title: "Configuration"
description: "Configure claude-mem settings"
---

## Settings File

Settings are stored in `~/.claude-mem/settings.json`. The file is auto-created with defaults on first run.

## All Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `CLAUDE_MEM_MODEL` | `claude-sonnet-4-5` | AI model for compression |
| `CLAUDE_MEM_WORKER_HOST` | `127.0.0.1` | Worker service host |
| `CLAUDE_MEM_WORKER_PORT` | `37777` | Worker service port |
| `CLAUDE_MEM_GIT_REMOTE_PREFERENCE` | `origin,upstream` | Git remote priority order |
| `CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY` | `project` | Default observation visibility |
| `CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS` | `90` | Days until API keys expire |
| `CLAUDE_MEM_AGENT_LOCKOUT_DURATION` | `300` | Lockout seconds after failed auth |
| `CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS` | `5` | Auth attempts before lockout |

## Git Remote Settings

Claude-mem uses git remotes to create portable project identifiers across machines.

```json
{
  "CLAUDE_MEM_GIT_REMOTE_PREFERENCE": "upstream,origin"
}
```

This setting controls which remote is preferred when a repository has multiple remotes.
The first matching remote in the list is used.

## Agent Settings

For multi-agent deployments, these settings control security and visibility:

```json
{
  "CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY": "department",
  "CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS": "30",
  "CLAUDE_MEM_AGENT_LOCKOUT_DURATION": "600",
  "CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS": "3"
}
```

See [Multi-Agent Architecture](/multi-agent) for details.
```

---

## Step 3: Create Multi-Agent Documentation

Create `docs/public/multi-agent.mdx`:

```mdx
---
title: "Multi-Agent Architecture"
description: "Share memories across multiple Claude agents"
---

## Overview

Claude-mem supports multiple agents sharing a memory database with visibility controls.
Each agent has a unique identifier, department assignment, and API key for authentication.

## Agent Lifecycle

### 1. Register

```bash
curl -X POST http://localhost:37777/api/agents/register \
  -H "Content-Type: application/json" \
  -d '{"id": "seb@laptop", "department": "engineering"}'
```

Response:
```json
{
  "success": true,
  "agent": {
    "id": "seb@laptop",
    "department": "engineering",
    "permissions": "read,write"
  },
  "apiKey": "cm_abc123..."
}
```

<Warning>
  Save the API key immediately! It is only shown once during registration.
</Warning>

### 2. Verify

```bash
curl -X POST http://localhost:37777/api/agents/verify \
  -H "Content-Type: application/json" \
  -d '{"id": "seb@laptop", "apiKey": "cm_abc123..."}'
```

### 3. Use

Include the API key in requests:

```bash
curl http://localhost:37777/api/agents/me \
  -H "Authorization: Bearer cm_abc123..."
```

### 4. Rotate Key

```bash
curl -X POST http://localhost:37777/api/agents/rotate-key \
  -H "Authorization: Bearer cm_abc123..."
```

### 5. Revoke Key

```bash
curl -X POST http://localhost:37777/api/agents/revoke \
  -H "Authorization: Bearer cm_abc123..."
```

## Visibility Levels

Observations can have different visibility levels:

| Level | Who Can See |
|-------|-------------|
| `private` | Only the creating agent |
| `department` | All agents in the same department |
| `project` | All agents with access to the project |
| `public` | All agents |

## Security

### API Key Best Practices

<Warning>
  **Never commit API keys to version control!**
</Warning>

- Store keys in environment variables or secure credential storage
- Keys expire after 90 days by default (configurable)
- Rotate keys regularly using the `/api/agents/rotate-key` endpoint
- Revoke compromised keys immediately

### Brute-Force Protection

- 5 failed authentication attempts trigger a 5-minute lockout
- Rate limiting: 20 auth attempts per 15 minutes per IP
- All auth events are logged to the audit table

### Audit Logging

All security events are logged:
- Agent registration
- Verification success/failure
- Key rotation
- Key revocation
- Lockouts

Query audit logs:
```sql
SELECT * FROM audit_log
WHERE agent_id = 'seb@laptop'
ORDER BY created_at_epoch DESC
LIMIT 50;
```
```

---

## Step 4: Create/Update API Reference

Create or update `docs/public/api-reference.mdx`:

```mdx
---
title: "API Reference"
description: "HTTP API endpoints for claude-mem"
---

## Agent Endpoints

### Register Agent

`POST /api/agents/register`

Register a new agent or update an existing one.

**Request:**
```json
{
  "id": "user@host",
  "department": "engineering",
  "permissions": "read,write"  // optional
}
```

**Response (new agent):**
```json
{
  "success": true,
  "agent": { ... },
  "apiKey": "cm_..."
}
```

**Response (existing agent):**
```json
{
  "success": true,
  "agent": { ... }
}
```

### Verify Agent

`POST /api/agents/verify`

Verify an agent with their API key.

**Request:**
```json
{
  "id": "user@host",
  "apiKey": "cm_..."
}
```

### Rotate API Key

`POST /api/agents/rotate-key`

**Requires authentication.**

Generate a new API key, invalidating the old one.

**Request (optional):**
```json
{
  "expiryDays": 30
}
```

**Response:**
```json
{
  "success": true,
  "apiKey": "cm_...",
  "expiresAt": "2026-05-03T..."
}
```

### Revoke API Key

`POST /api/agents/revoke`

**Requires authentication.**

Revoke the current API key.

### Get Self Info

`GET /api/agents/me`

**Requires authentication.**

Get information about the authenticated agent.

**Response:**
```json
{
  "agent": {
    "id": "user@host",
    "department": "engineering",
    "permissions": "read,write",
    "verified": true,
    "key_expires_at": "2026-05-03T...",
    "days_until_expiry": 89
  }
}
```

## Error Responses

All errors return JSON:

```json
{
  "error": "ERROR_CODE",
  "message": "Human readable message"
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `FORBIDDEN` | 403 | Agent not verified |
| `TOO_MANY_REQUESTS` | 429 | Rate limited or locked out |
| `INVALID_ID_FORMAT` | 400 | Agent ID format invalid |
| `BAD_REQUEST` | 400 | Missing required fields |
```

---

## Step 5: Update CLAUDE.md

Add to project `CLAUDE.md`:

```markdown
## Multi-Agent Support

Claude-mem supports multiple agents sharing memories with visibility controls.
See `docs/public/multi-agent.mdx` for full documentation.

### Quick Reference

- Agent ID format: `user@host`
- API endpoints: `/api/agents/*`
- Visibility levels: private, department, project, public
- Key expiration: 90 days default
```

---

## Step 6: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-3.3.spec.md`.

---

## Step 7: Commit

```bash
git add docs/public/configuration.mdx \
        docs/public/multi-agent.mdx \
        docs/public/api-reference.mdx \
        CLAUDE.md \
        docs/plans/agents/specs/task-3.3.spec.md
git commit -m "docs: add documentation for git identity and multi-agent features

- Updated configuration docs with new settings
- New multi-agent architecture guide
- API reference with agent endpoints
- Security best practices
- CLAUDE.md quick reference

Part of #14, #15"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-3.4-final-review.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 3.3 -->
## Context from Previous Agent

Task 3.3 is complete. Documentation has been updated:

### New/Updated Docs
- `docs/public/configuration.mdx` - New settings documented
- `docs/public/multi-agent.mdx` - Full multi-agent guide
- `docs/public/api-reference.mdx` - Agent API endpoints
- `CLAUDE.md` - Quick reference added

Your task is final review:
1. Run all tests
2. Check for any missed integration points
3. Verify documentation accuracy
4. Create release notes

All documentation complete.
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] Configuration docs updated
- [ ] Multi-agent guide complete
- [ ] API reference complete
- [ ] Security warnings included
- [ ] CLAUDE.md updated
- [ ] Code committed
- [ ] Handoff comment added to task-3.4
