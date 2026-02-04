<!-- HANDOFF FROM TASK 1.2 -->
## Context from Previous Agent

Tasks 1.1 and 1.2 are complete. Project identification now works as follows:

1. `getProjectName(cwd)` returns git remote identifier (e.g., `github.com/user/repo`)
2. Falls back to folder basename if no git remote
3. Returns `'unknown-project'` for invalid paths

**Files created:**
- `src/utils/git-available.ts`: `isGitAvailable()`, `resetGitAvailableCache()`
- `src/utils/git-remote.ts`: `normalizeGitUrl()`, `parseGitRemotes()`, `getPreferredRemote()`, `getGitRemoteIdentifier()`
- `src/utils/project-name.ts`: Updated to use git remote first

**Important for migration:** Existing observations use folder basenames (e.g., `claude-mem`).
The new system will produce git remote IDs (e.g., `github.com/sebastienvg/claude-mem`).

The project_aliases table must map old -> new to preserve data continuity.

Tests passing: `bun test tests/utils/git-*.test.ts tests/utils/project-name.test.ts`
<!-- END HANDOFF -->

# Task 1.3: Add Database Migration for Project Aliases

**Phase:** 1 - Git Repository Identification
**Issue:** #14
**Depends On:** Task 1.2
**Next Task:** `task-1.4-project-alias-service.md`

---

## Objective

Add a database migration to create the `project_aliases` table, which maps old folder-based project names to new git-remote-based identifiers for backwards compatibility.

---

## Files to Modify/Create

| File | Type |
|------|------|
| `src/services/sqlite/migrations.ts` | Modify |
| `tests/sqlite/project-aliases-migration.test.ts` | Create |
| `docs/plans/agents/specs/task-1.3.spec.md` | Create |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-1.3.spec.md`:

```markdown
# Task 1.3 Specification: Project Aliases Migration

## Requirements

### Migration 008 - project_aliases table
- [ ] Table name: `project_aliases`
- [ ] Columns:
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT
  - `old_project` TEXT NOT NULL (the folder basename)
  - `new_project` TEXT NOT NULL (the git remote identifier)
  - `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
  - `created_at_epoch` INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
- [ ] Unique constraint on (old_project, new_project) pair
- [ ] Index on `new_project` for reverse lookups
- [ ] Index on `created_at_epoch` for cleanup queries
- [ ] Down migration drops the table

## Test Cases

### project-aliases-migration.test.ts
- [ ] Migration creates project_aliases table
- [ ] Can insert alias mapping
- [ ] Unique constraint prevents duplicates
- [ ] Can query aliases by new_project
- [ ] Can query aliases by old_project
```

---

## Step 2: Read Current Migrations

First, read `src/services/sqlite/migrations.ts` to understand the current migration structure and version number.

---

## Step 3: Write Failing Tests

Create `tests/sqlite/project-aliases-migration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/services/sqlite/migrations.js';

describe('Project Aliases Migration', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create project_aliases table', () => {
    const tables = db.query(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='project_aliases'
    `).all();

    expect(tables).toHaveLength(1);
  });

  it('should allow inserting alias mapping', () => {
    db.run(`
      INSERT INTO project_aliases (old_project, new_project)
      VALUES ('claude-mem', 'github.com/sebastienvg/claude-mem')
    `);

    const result = db.query(`
      SELECT * FROM project_aliases WHERE old_project = 'claude-mem'
    `).get() as any;

    expect(result.new_project).toBe('github.com/sebastienvg/claude-mem');
    expect(result.created_at).toBeTruthy();
    expect(result.created_at_epoch).toBeGreaterThan(0);
  });

  it('should enforce unique constraint on old_project + new_project', () => {
    db.run(`
      INSERT INTO project_aliases (old_project, new_project)
      VALUES ('my-project', 'github.com/user/my-project')
    `);

    expect(() => {
      db.run(`
        INSERT INTO project_aliases (old_project, new_project)
        VALUES ('my-project', 'github.com/user/my-project')
      `);
    }).toThrow();
  });

  it('should allow same old_project with different new_project', () => {
    // This could happen if a project is forked
    db.run(`
      INSERT INTO project_aliases (old_project, new_project)
      VALUES ('my-project', 'github.com/user1/my-project')
    `);
    db.run(`
      INSERT INTO project_aliases (old_project, new_project)
      VALUES ('my-project', 'github.com/user2/my-project')
    `);

    const results = db.query(`
      SELECT * FROM project_aliases WHERE old_project = 'my-project'
    `).all();

    expect(results).toHaveLength(2);
  });

  it('should query aliases by new_project', () => {
    db.run(`
      INSERT INTO project_aliases (old_project, new_project)
      VALUES ('proj-a', 'github.com/user/repo')
    `);
    db.run(`
      INSERT INTO project_aliases (old_project, new_project)
      VALUES ('proj-b', 'github.com/user/repo')
    `);

    const results = db.query(`
      SELECT old_project FROM project_aliases
      WHERE new_project = 'github.com/user/repo'
    `).all() as { old_project: string }[];

    expect(results.map(r => r.old_project)).toContain('proj-a');
    expect(results.map(r => r.old_project)).toContain('proj-b');
  });
});
```

---

## Step 4: Run Tests (Should Fail)

```bash
bun test tests/sqlite/project-aliases-migration.test.ts
```

---

## Step 5: Add Migration

Add to `src/services/sqlite/migrations.ts`:

```typescript
/**
 * Migration 008 - Add project aliases table for migration compatibility
 *
 * Maps old folder-based project names to new git-remote-based identifiers.
 * Enables querying historical data using either format.
 */
export const migration008: Migration = {
  version: 8,
  up: (db: Database) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS project_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        old_project TEXT NOT NULL,
        new_project TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at_epoch INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        UNIQUE(old_project, new_project)
      )
    `);

    // Index for looking up aliases when querying by new project
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_aliases_new
      ON project_aliases(new_project)
    `);

    // Index for cleanup queries by age
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_aliases_created
      ON project_aliases(created_at_epoch)
    `);

    console.log('✅ Created project_aliases table');
  },

  down: (db: Database) => {
    db.run(`DROP TABLE IF EXISTS project_aliases`);
  }
};

// Add to migrations array
export const migrations: Migration[] = [
  // ... existing migrations
  migration008,
];
```

**Note:** Verify the current highest migration version and adjust accordingly.

---

## Step 6: Run Tests (Should Pass)

```bash
bun test tests/sqlite/project-aliases-migration.test.ts
```

---

## Step 7: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-1.3.spec.md`.

---

## Step 8: Commit

```bash
git add src/services/sqlite/migrations.ts \
        tests/sqlite/project-aliases-migration.test.ts \
        docs/plans/agents/specs/task-1.3.spec.md
git commit -m "feat: add project_aliases table for migration compatibility

- Maps old folder-based names to git remote identifiers
- Unique constraint on (old_project, new_project) pairs
- Indexes for efficient lookups and cleanup

Part of #14"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-1.4-project-alias-service.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 1.3 -->
## Context from Previous Agent

Tasks 1.1-1.3 are complete. The database now has a `project_aliases` table:

```sql
CREATE TABLE project_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  old_project TEXT NOT NULL,
  new_project TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL,
  UNIQUE(old_project, new_project)
);
```

Indexes exist on `new_project` and `created_at_epoch`.

Your task is to create a service that:
1. Registers new aliases when sessions start
2. Resolves all aliases for a project when querying
3. Implements cleanup for old aliases

Tests passing: `bun test tests/sqlite/project-aliases-migration.test.ts`
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All tests pass
- [ ] Migration version correct (check current highest)
- [ ] Code committed
- [ ] Handoff comment added to task-1.4
