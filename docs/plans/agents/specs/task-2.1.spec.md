# Task 2.1 Specification: Agents Table Migration

**Migration Version:** 21
**Created:** 2026-02-03
**Status:** COMPLETE

## Migration 021 - Multi-Agent Architecture

### Agents Table
- [x] `id` TEXT PRIMARY KEY (format: user@host)
- [x] `department` TEXT NOT NULL DEFAULT 'default'
- [x] `permissions` TEXT NOT NULL DEFAULT 'read,write'
- [x] `api_key_prefix` TEXT (first 12 chars for O(1) lookup)
- [x] `api_key_hash` TEXT UNIQUE (SHA-256 hash of full key)
- [x] `created_at` TEXT NOT NULL DEFAULT datetime('now')
- [x] `created_at_epoch` INTEGER NOT NULL
- [x] `last_seen_at` TEXT
- [x] `last_seen_at_epoch` INTEGER
- [x] `verified` INTEGER NOT NULL DEFAULT 0
- [x] `expires_at` TEXT
- [x] `expires_at_epoch` INTEGER
- [x] `failed_attempts` INTEGER NOT NULL DEFAULT 0
- [x] `locked_until_epoch` INTEGER

### Agents Table Indexes
- [x] idx_agents_department ON agents(department)
- [x] idx_agents_verified ON agents(verified)
- [x] idx_agents_api_key_prefix ON agents(api_key_prefix) -- O(1) lookup
- [x] idx_agents_api_key_hash UNIQUE ON agents(api_key_hash)

### Observations Table Extensions
- [x] ADD COLUMN agent TEXT DEFAULT 'legacy'
- [x] ADD COLUMN department TEXT DEFAULT 'default'
- [x] ADD COLUMN visibility TEXT DEFAULT 'project' CHECK(visibility IN ('private', 'department', 'project', 'public'))
- [x] idx_observations_agent ON observations(agent)
- [x] idx_observations_department ON observations(department)
- [x] idx_observations_visibility ON observations(visibility)

### Session Summaries Extensions
- [x] ADD COLUMN agent TEXT DEFAULT 'legacy'
- [x] ADD COLUMN department TEXT DEFAULT 'default'
- [x] ADD COLUMN visibility TEXT DEFAULT 'project'

### Audit Log Table
- [x] `id` INTEGER PRIMARY KEY AUTOINCREMENT
- [x] `agent_id` TEXT NOT NULL
- [x] `action` TEXT NOT NULL
- [x] `resource_type` TEXT
- [x] `resource_id` TEXT
- [x] `details` TEXT (JSON)
- [x] `ip_address` TEXT
- [x] `created_at` TEXT NOT NULL DEFAULT datetime('now')
- [x] `created_at_epoch` INTEGER NOT NULL DEFAULT strftime('%s', 'now')
- [x] idx_audit_log_agent ON audit_log(agent_id)
- [x] idx_audit_log_action ON audit_log(action)
- [x] idx_audit_log_created ON audit_log(created_at_epoch DESC)

## Test Cases

### agents-migration.test.ts
- [x] Creates agents table with all columns
- [x] Creates audit_log table with all columns
- [x] Adds agent/department/visibility columns to observations
- [x] Adds agent/department/visibility columns to session_summaries
- [x] api_key_prefix index exists for O(1) lookup
- [x] api_key_hash unique constraint works
- [x] Visibility CHECK constraint enforced on observations
- [x] Migration is idempotent (can run multiple times safely)
- [x] Default values are correctly applied

## Design Notes

### O(1) Key Lookup Strategy
The `api_key_prefix` column stores the first 12 characters of the API key. This allows:
1. Index lookup by prefix (O(1) in B-tree)
2. Full hash verification after finding candidate
3. Graceful handling of prefix collisions (verify full hash)

### Brute-Force Protection
- `failed_attempts`: Counter incremented on hash mismatch
- `locked_until_epoch`: Set when `failed_attempts >= 5`
- Lockout duration: 300 seconds (5 minutes)

### Visibility Model
- `private`: Only the creating agent can access
- `department`: Agents in the same department can access
- `project`: All agents in the project can access (currently global)
- `public`: Anyone can access

## Implementation Notes

### Migration Location
- File: `/Users/seb/AI/claude-mem/src/services/sqlite/migrations/runner.ts`
- Method: `createMultiAgentTables()` (migration 21)

### Test Location
- File: `/Users/seb/AI/claude-mem/tests/sqlite/agents-migration.test.ts`
- Tests: 23 tests, all passing

### Key Implementation Details
1. The observations table is recreated (not just altered) to include the CHECK constraint on visibility
2. The migration is fully idempotent - it checks for existing tables/columns before creating
3. All existing data is preserved during the observations table migration
4. Default values ensure backward compatibility with existing records
