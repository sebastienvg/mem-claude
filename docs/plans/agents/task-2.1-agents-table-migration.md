<!-- HANDOFF FROM TASK 1.7 -->
## Phase 1 Complete!

All Phase 1 tasks (1.1-1.7) are complete. Git-based project identification is now fully functional:

### Summary of Phase 1 Changes

1. **Git Remote Utilities** (`src/utils/git-remote.ts`)
   - `normalizeGitUrl()`: Converts SSH/HTTPS to `github.com/user/repo`
   - `getGitRemoteIdentifier()`: Gets remote for a directory

2. **Project Name** (`src/utils/project-name.ts`)
   - `getProjectName()`: Returns git remote ID, falls back to basename

3. **Project Aliases** (`src/services/sqlite/project-aliases.ts`)
   - `registerProjectAlias()`: Maps old -> new project names
   - `getProjectsWithAliases()`: Expands project for queries
   - `cleanupOldAliases()`: Maintenance function

4. **Session Integration** (`src/hooks/session-alias.ts`)
   - Auto-registers aliases on session start

5. **Query Updates**
   - All project-filtered queries now include aliases

6. **CLI Commands** (`scripts/alias-cli.ts`)
   - `bun scripts/alias-cli.ts list [project]`
   - `bun scripts/alias-cli.ts add <old> <new>`
   - `bun scripts/alias-cli.ts cleanup [--days=365] [--dry-run]`
   - `bun scripts/alias-cli.ts count <project>`

### Ready for Phase 2

Phase 2 implements multi-agent architecture. The project identification system
is now stable and can be relied upon for agent scoping.

Tests passing: All Phase 1 tests
<!-- END HANDOFF -->

# Task 2.1: Add Agents Table Migration (with O(1) Key Lookup)

**Phase:** 2 - Multi-Agent Architecture
**Issue:** #15
**Depends On:** Phase 1 complete (task-1.7)
**Next Task:** `task-2.2-agent-service.md`

---

## Objective

Add database migration for multi-agent support: agents table with O(1) API key lookup, brute-force protection, audit logging, and observation metadata columns.

---

## Files to Modify/Create

| File | Type |
|------|------|
| `src/services/sqlite/migrations.ts` | Modify |
| `tests/sqlite/agents-migration.test.ts` | Create |
| `docs/plans/agents/specs/task-2.1.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-2.1.spec.md`:

```markdown
# Task 2.1 Specification: Agents Table Migration

## Migration 009 - Multi-Agent Architecture

### Agents Table
- [ ] `id` TEXT PRIMARY KEY (format: user@host)
- [ ] `department` TEXT NOT NULL DEFAULT 'default'
- [ ] `permissions` TEXT NOT NULL DEFAULT 'read,write'
- [ ] `api_key_prefix` TEXT (first 12 chars for O(1) lookup)
- [ ] `api_key_hash` TEXT UNIQUE (SHA-256 hash of full key)
- [ ] `created_at` TEXT NOT NULL DEFAULT datetime('now')
- [ ] `created_at_epoch` INTEGER NOT NULL
- [ ] `last_seen_at` TEXT
- [ ] `last_seen_at_epoch` INTEGER
- [ ] `verified` INTEGER NOT NULL DEFAULT 0
- [ ] `expires_at` TEXT
- [ ] `expires_at_epoch` INTEGER
- [ ] `failed_attempts` INTEGER NOT NULL DEFAULT 0
- [ ] `locked_until_epoch` INTEGER

### Agents Table Indexes
- [ ] idx_agents_department ON agents(department)
- [ ] idx_agents_verified ON agents(verified)
- [ ] idx_agents_api_key_prefix ON agents(api_key_prefix) -- O(1) lookup
- [ ] idx_agents_api_key_hash UNIQUE ON agents(api_key_hash)

### Observations Table Extensions
- [ ] ADD COLUMN agent TEXT DEFAULT 'legacy'
- [ ] ADD COLUMN department TEXT DEFAULT 'default'
- [ ] ADD COLUMN visibility TEXT DEFAULT 'project' CHECK(...)
- [ ] idx_observations_agent
- [ ] idx_observations_department
- [ ] idx_observations_visibility

### Session Summaries Extensions
- [ ] ADD COLUMN agent TEXT DEFAULT 'legacy'
- [ ] ADD COLUMN department TEXT DEFAULT 'default'
- [ ] ADD COLUMN visibility TEXT DEFAULT 'project'

### Audit Log Table
- [ ] `id` INTEGER PRIMARY KEY AUTOINCREMENT
- [ ] `agent_id` TEXT NOT NULL
- [ ] `action` TEXT NOT NULL
- [ ] `resource_type` TEXT
- [ ] `resource_id` TEXT
- [ ] `details` TEXT (JSON)
- [ ] `ip_address` TEXT
- [ ] `created_at` TEXT NOT NULL
- [ ] `created_at_epoch` INTEGER NOT NULL
- [ ] Indexes on agent_id, action, created_at_epoch DESC

## Test Cases

### agents-migration.test.ts
- [ ] Creates agents table with all columns
- [ ] Creates audit_log table
- [ ] Adds agent/department/visibility columns to observations
- [ ] Adds columns to session_summaries
- [ ] api_key_prefix index exists
- [ ] api_key_hash unique constraint works
- [ ] Visibility CHECK constraint enforced
```

---

## Step 2: Write Failing Tests

Create `tests/sqlite/agents-migration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/services/sqlite/migrations.js';

describe('Agents Migration (009)', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('agents table', () => {
    it('should create agents table', () => {
      const tables = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='agents'
      `).all();

      expect(tables).toHaveLength(1);
    });

    it('should have all required columns', () => {
      const columns = db.query(`PRAGMA table_info(agents)`).all() as any[];
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('department');
      expect(columnNames).toContain('permissions');
      expect(columnNames).toContain('api_key_prefix');
      expect(columnNames).toContain('api_key_hash');
      expect(columnNames).toContain('verified');
      expect(columnNames).toContain('expires_at_epoch');
      expect(columnNames).toContain('failed_attempts');
      expect(columnNames).toContain('locked_until_epoch');
    });

    it('should have api_key_prefix index', () => {
      const indexes = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='agents' AND name LIKE '%api_key_prefix%'
      `).all();

      expect(indexes.length).toBeGreaterThan(0);
    });

    it('should enforce unique api_key_hash', () => {
      db.run(`
        INSERT INTO agents (id, api_key_hash)
        VALUES ('agent1@host', 'sha256:abc123')
      `);

      expect(() => {
        db.run(`
          INSERT INTO agents (id, api_key_hash)
          VALUES ('agent2@host', 'sha256:abc123')
        `);
      }).toThrow();
    });
  });

  describe('audit_log table', () => {
    it('should create audit_log table', () => {
      const tables = db.query(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='audit_log'
      `).all();

      expect(tables).toHaveLength(1);
    });

    it('should allow inserting audit entries', () => {
      db.run(`
        INSERT INTO audit_log (agent_id, action, details)
        VALUES ('test@host', 'login', '{"ip": "127.0.0.1"}')
      `);

      const entry = db.query(`SELECT * FROM audit_log WHERE agent_id = 'test@host'`).get() as any;
      expect(entry.action).toBe('login');
    });
  });

  describe('observations extensions', () => {
    it('should have agent column', () => {
      const columns = db.query(`PRAGMA table_info(observations)`).all() as any[];
      const agentCol = columns.find(c => c.name === 'agent');

      expect(agentCol).toBeTruthy();
      expect(agentCol.dflt_value).toBe("'legacy'");
    });

    it('should have visibility column with CHECK constraint', () => {
      const columns = db.query(`PRAGMA table_info(observations)`).all() as any[];
      const visCol = columns.find(c => c.name === 'visibility');

      expect(visCol).toBeTruthy();
    });

    it('should reject invalid visibility values', () => {
      // First insert a valid observation
      db.run(`
        INSERT INTO observations (
          session_id, project, type, title, narrative, concepts_json, files_json, tools_json
        ) VALUES (
          'test-session', 'test-project', 'discovery', 'Test', 'Test narrative', '[]', '[]', '[]'
        )
      `);

      // Try to update with invalid visibility
      expect(() => {
        db.run(`UPDATE observations SET visibility = 'invalid' WHERE session_id = 'test-session'`);
      }).toThrow();
    });
  });

  describe('session_summaries extensions', () => {
    it('should have agent and department columns', () => {
      const columns = db.query(`PRAGMA table_info(session_summaries)`).all() as any[];
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('agent');
      expect(columnNames).toContain('department');
      expect(columnNames).toContain('visibility');
    });
  });
});
```

---

## Step 3: Run Tests (Should Fail)

```bash
bun test tests/sqlite/agents-migration.test.ts
```

---

## Step 4: Add Migration

Add to `src/services/sqlite/migrations.ts`:

```typescript
/**
 * Migration 009 - Add multi-agent architecture tables
 *
 * Key design decisions:
 * - api_key_prefix: First 12 chars of key for O(1) lookup (indexed)
 * - api_key_hash: Full SHA-256 hash for verification
 * - expires_at_epoch: Optional key expiration (default 90 days)
 * - failed_attempts: Counter for brute-force protection
 * - locked_until_epoch: Temporary lockout after too many failures
 */
export const migration009: Migration = {
  version: 9,
  up: (db: Database) => {
    // Agents table with O(1) key lookup
    db.run(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        department TEXT NOT NULL DEFAULT 'default',
        permissions TEXT NOT NULL DEFAULT 'read,write',
        api_key_prefix TEXT,
        api_key_hash TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at_epoch INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        last_seen_at TEXT,
        last_seen_at_epoch INTEGER,
        verified INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        expires_at_epoch INTEGER,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until_epoch INTEGER
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_agents_department ON agents(department)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_agents_verified ON agents(verified)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_agents_api_key_prefix ON agents(api_key_prefix)`);

    // Add agent metadata columns to observations
    db.run(`ALTER TABLE observations ADD COLUMN agent TEXT DEFAULT 'legacy'`);
    db.run(`ALTER TABLE observations ADD COLUMN department TEXT DEFAULT 'default'`);
    db.run(`
      ALTER TABLE observations ADD COLUMN visibility TEXT DEFAULT 'project'
      CHECK(visibility IN ('private', 'department', 'project', 'public'))
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_observations_agent ON observations(agent)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_observations_department ON observations(department)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_observations_visibility ON observations(visibility)`);

    // Add to session_summaries
    db.run(`ALTER TABLE session_summaries ADD COLUMN agent TEXT DEFAULT 'legacy'`);
    db.run(`ALTER TABLE session_summaries ADD COLUMN department TEXT DEFAULT 'default'`);
    db.run(`ALTER TABLE session_summaries ADD COLUMN visibility TEXT DEFAULT 'project'`);

    // Audit log for security tracking
    db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at_epoch INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
      )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_agent ON audit_log(agent_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at_epoch DESC)`);

    console.log('✅ Created multi-agent architecture tables with O(1) key lookup');
  },

  down: (db: Database) => {
    db.run(`DROP TABLE IF EXISTS audit_log`);
    db.run(`DROP TABLE IF EXISTS agents`);
    // Note: SQLite doesn't support DROP COLUMN, so observation columns persist
  }
};

// Add to migrations array
export const migrations: Migration[] = [
  // ... existing migrations (001-008)
  migration009,
];
```

**Note:** Verify the current migration version and adjust accordingly.

---

## Step 5: Run Tests (Should Pass)

```bash
bun test tests/sqlite/agents-migration.test.ts
```

---

## Step 6: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-2.1.spec.md`.

---

## Step 7: Commit

```bash
git add src/services/sqlite/migrations.ts \
        tests/sqlite/agents-migration.test.ts \
        docs/plans/agents/specs/task-2.1.spec.md
git commit -m "feat: add agents table with O(1 key lookup and brute-force protection

Migration 009 adds:
- agents table with api_key_prefix index for O(1) lookup
- failed_attempts/locked_until_epoch for brute-force protection
- expires_at_epoch for key expiration
- audit_log table for security tracking
- agent/department/visibility columns on observations
- Same extensions to session_summaries

Part of #15"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-2.2-agent-service.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 2.1 -->
## Context from Previous Agent

Task 2.1 is complete. The database now has multi-agent support:

### New Tables
- `agents`: Agent registry with API key management
- `audit_log`: Security event tracking

### Key Columns in agents
- `api_key_prefix`: First 12 chars for O(1) lookup (indexed)
- `api_key_hash`: Full SHA-256 hash (unique)
- `failed_attempts`: Brute-force counter
- `locked_until_epoch`: Lockout timestamp
- `expires_at_epoch`: Key expiration

### Extended Columns
- `observations`: +agent, +department, +visibility
- `session_summaries`: +agent, +department, +visibility

### Visibility Values
- 'private', 'department', 'project', 'public'

Your task is to create AgentService with:
- O(1) key lookup via prefix
- Brute-force protection (5 attempts → 5 min lockout)
- Key expiration (90 days default)
- Audit logging

Tests passing: `bun test tests/sqlite/agents-migration.test.ts`
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All tests pass
- [ ] Migration version correct
- [ ] O(1) lookup index created
- [ ] Code committed
- [ ] Handoff comment added to task-2.2
