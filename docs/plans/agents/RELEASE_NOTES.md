# Release Notes: Git Identity & Multi-Agent Support

## Version: TBD (Phase 3 Complete)

This release introduces two major features: Git-based project identification and multi-agent architecture support.

---

## Features

### Git-Based Project Identity (#14)

Projects are now identified by git remote URL instead of folder basename, making project identification portable across machines and git worktrees.

**How it works:**
- Primary identifier format: `github.com/user/repo` (normalized from SSH or HTTPS URLs)
- Falls back to folder basename for local-only repos without remotes
- Automatic alias registration links old folder-based names to new git-based identifiers
- Historical observations remain accessible via alias resolution

**Benefits:**
- Same project recognized across different machines
- Git worktrees share the same project identity
- Fork workflows supported with `upstream` remote preference

### Multi-Agent Architecture (#15)

Multiple Claude instances can now share a memory database with fine-grained access control.

**Key features:**
- **Agent Identity**: `user@host` format for unique identification
- **Visibility Controls**: private, department, project, public
- **Secure Authentication**: SHA-256 hashed API keys with O(1) lookup
- **Brute-Force Protection**: Automatic lockout after failed attempts
- **Key Lifecycle**: 90-day expiration with rotation and revocation support
- **Audit Logging**: All security events logged for compliance

**API Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents/register` | POST | Register a new agent |
| `/api/agents/verify` | POST | Verify an agent's API key |
| `/api/agents/rotate-key` | POST | Generate new API key |
| `/api/agents/revoke` | POST | Permanently revoke key |
| `/api/agents/me` | GET | Get authenticated agent info |

---

## New Configuration Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `CLAUDE_MEM_GIT_REMOTE_PREFERENCE` | `origin,upstream` | Git remote priority order |
| `CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY` | `project` | Default observation visibility |
| `CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS` | `90` | Days until API keys expire |
| `CLAUDE_MEM_AGENT_LOCKOUT_DURATION` | `300` | Lockout duration in seconds |
| `CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS` | `5` | Attempts before lockout |

---

## CLI Commands

New alias management commands:

```bash
# List all aliases for a project
claude-mem alias list [project]

# Add a manual alias
claude-mem alias add <old-project> <new-project>

# Cleanup old aliases (default: older than 365 days)
claude-mem alias cleanup [--days=365]

# Count aliases for a project
claude-mem alias count <project>
```

---

## Database Changes

Two new migrations are included:

### Migration 21: Multi-Agent Tables
- `agents` table with O(1) API key lookup
- `audit_log` table for security events
- `agent`, `department`, `visibility` columns added to observations and session_summaries

### Migration 22: Project Aliases
- `project_aliases` table for backwards compatibility
- Links old folder-based identifiers to new git-based identifiers

**Backwards Compatibility:**
- Existing data automatically receives default values:
  - `agent`: 'legacy'
  - `department`: 'default'
  - `visibility`: 'project'
- No manual migration required

---

## Security Considerations

### API Key Security
- Keys are hashed with SHA-256 before storage
- Only the first 12 characters are indexed for lookup
- Keys expire after 90 days by default
- Brute-force protection locks agents after 5 failed attempts

### Visibility Enforcement
- All queries now enforce visibility rules
- `private` observations only visible to creating agent
- `department` observations visible to same-department agents
- `project` observations visible to all agents (current default)
- `public` observations visible globally

---

## Documentation

New documentation pages added:
- **Multi-Agent Architecture** (`/multi-agent`) - Full guide with lifecycle, security, and configuration
- **API Reference** (`/api-reference`) - Complete endpoint documentation with examples

Updated pages:
- **Configuration** (`/configuration`) - New settings sections for git remote and agent settings
- **CLAUDE.md** - Quick reference for developers

---

## Testing

Phase 3 testing summary:
- 22 E2E tests for project identity and multi-agent features
- 40 unit tests for AgentService
- 122 SQLite/migration tests
- 28 project alias tests
- 26 git remote tests
- 29 settings integration tests

**Total: 267 Phase 3 related tests passing**

---

## Breaking Changes

**None.** This release is fully backwards compatible.

---

## Upgrade Instructions

1. Update claude-mem to the new version
2. Restart the worker service: `npm run worker:restart`
3. Migrations run automatically on first startup

No manual intervention required.
