<!-- HANDOFF FROM TASK 1.3 -->
## Context from Previous Agent

Tasks 1.1-1.3 are complete. The database now has a `project_aliases` table:

```sql
CREATE TABLE project_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  old_project TEXT NOT NULL,
  new_project TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at_epoch INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
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

# Task 1.4: Create Project Alias Resolution Service

**Phase:** 1 - Git Repository Identification
**Issue:** #14
**Depends On:** Task 1.3 (project_aliases table)
**Next Task:** `task-1.5-session-alias-registration.md`

---

## Objective

Create a service to manage project aliases: registering new mappings, resolving aliases for queries, and cleaning up old entries. Includes a hard cap on alias count to avoid SQLite parameter limits.

---

## Files to Create

| File | Type |
|------|------|
| `src/services/sqlite/project-aliases.ts` | Implementation |
| `tests/sqlite/project-alias-resolution.test.ts` | Test |
| `docs/plans/agents/specs/task-1.4.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-1.4.spec.md`:

```markdown
# Task 1.4 Specification: Project Alias Resolution Service

## Constants

- [ ] MAX_ALIASES_IN_QUERY = 100 (hard cap to avoid SQLite 999 parameter limit)

## Functions

### registerProjectAlias(db, oldProject, newProject)
- [ ] Inserts new alias mapping
- [ ] Uses INSERT OR IGNORE to handle duplicates gracefully
- [ ] Returns boolean indicating if new alias was created
- [ ] Logs alias registration

### getProjectsWithAliases(db, project)
- [ ] Returns array starting with the input project
- [ ] Appends all old_project aliases for the project
- [ ] Limited to MAX_ALIASES_IN_QUERY aliases
- [ ] Logs warning if limit is exceeded
- [ ] Returns at least [project] even if no aliases

### getAliasCount(db, project)
- [ ] Returns total count of aliases for a project
- [ ] Used to check if limit was exceeded

### cleanupOldAliases(db, olderThanDays = 365)
- [ ] Deletes aliases older than specified days
- [ ] Returns number of deleted rows
- [ ] Logs cleanup result

## Test Cases

### project-alias-resolution.test.ts
- [ ] registerProjectAlias: Creates new alias
- [ ] registerProjectAlias: Ignores duplicate gracefully
- [ ] getProjectsWithAliases: Returns project + aliases
- [ ] getProjectsWithAliases: Returns only project when no aliases
- [ ] getProjectsWithAliases: Respects MAX_ALIASES_IN_QUERY limit
- [ ] getAliasCount: Returns correct count
- [ ] cleanupOldAliases: Deletes old aliases
- [ ] cleanupOldAliases: Keeps recent aliases
```

---

## Step 2: Write Failing Tests

Create `tests/sqlite/project-alias-resolution.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/services/sqlite/migrations.js';
import {
  registerProjectAlias,
  getProjectsWithAliases,
  getAliasCount,
  cleanupOldAliases,
  MAX_ALIASES_IN_QUERY
} from '../../src/services/sqlite/project-aliases.js';

describe('Project Alias Resolution Service', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('registerProjectAlias', () => {
    it('should create new alias and return true', () => {
      const result = registerProjectAlias(db, 'old-name', 'github.com/user/repo');
      expect(result).toBe(true);

      const count = getAliasCount(db, 'github.com/user/repo');
      expect(count).toBe(1);
    });

    it('should ignore duplicate and return false', () => {
      registerProjectAlias(db, 'old-name', 'github.com/user/repo');
      const result = registerProjectAlias(db, 'old-name', 'github.com/user/repo');

      expect(result).toBe(false);
      expect(getAliasCount(db, 'github.com/user/repo')).toBe(1);
    });
  });

  describe('getProjectsWithAliases', () => {
    it('should return project + aliases', () => {
      registerProjectAlias(db, 'alias-1', 'github.com/user/repo');
      registerProjectAlias(db, 'alias-2', 'github.com/user/repo');

      const projects = getProjectsWithAliases(db, 'github.com/user/repo');

      expect(projects).toContain('github.com/user/repo');
      expect(projects).toContain('alias-1');
      expect(projects).toContain('alias-2');
      expect(projects).toHaveLength(3);
    });

    it('should return only project when no aliases', () => {
      const projects = getProjectsWithAliases(db, 'github.com/user/new-repo');

      expect(projects).toEqual(['github.com/user/new-repo']);
    });

    it('should respect MAX_ALIASES_IN_QUERY limit', () => {
      // Insert more than MAX_ALIASES_IN_QUERY aliases
      for (let i = 0; i < MAX_ALIASES_IN_QUERY + 10; i++) {
        db.run(`
          INSERT INTO project_aliases (old_project, new_project)
          VALUES (?, 'github.com/user/repo')
        `, [`alias-${i}`]);
      }

      const projects = getProjectsWithAliases(db, 'github.com/user/repo');

      // Should have project + MAX_ALIASES_IN_QUERY aliases
      expect(projects.length).toBeLessThanOrEqual(MAX_ALIASES_IN_QUERY + 1);
    });
  });

  describe('getAliasCount', () => {
    it('should return correct count', () => {
      registerProjectAlias(db, 'a', 'github.com/user/repo');
      registerProjectAlias(db, 'b', 'github.com/user/repo');
      registerProjectAlias(db, 'c', 'github.com/user/repo');

      expect(getAliasCount(db, 'github.com/user/repo')).toBe(3);
    });

    it('should return 0 for project without aliases', () => {
      expect(getAliasCount(db, 'github.com/user/new')).toBe(0);
    });
  });

  describe('cleanupOldAliases', () => {
    it('should delete old aliases', () => {
      // Insert alias with old timestamp
      const oldEpoch = Math.floor(Date.now() / 1000) - (400 * 86400); // 400 days ago
      db.run(`
        INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
        VALUES ('old-alias', 'github.com/user/repo', ?)
      `, [oldEpoch]);

      // Insert recent alias
      registerProjectAlias(db, 'new-alias', 'github.com/user/repo');

      const deleted = cleanupOldAliases(db, 365);

      expect(deleted).toBe(1);
      expect(getAliasCount(db, 'github.com/user/repo')).toBe(1);
    });

    it('should keep recent aliases', () => {
      registerProjectAlias(db, 'recent', 'github.com/user/repo');

      const deleted = cleanupOldAliases(db, 365);

      expect(deleted).toBe(0);
      expect(getAliasCount(db, 'github.com/user/repo')).toBe(1);
    });
  });
});
```

---

## Step 3: Run Tests (Should Fail)

```bash
bun test tests/sqlite/project-alias-resolution.test.ts
```

---

## Step 4: Implement Service

Create `src/services/sqlite/project-aliases.ts`:

```typescript
import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

/** Maximum aliases to include in IN clause (SQLite limit is 999) */
export const MAX_ALIASES_IN_QUERY = 100;

/**
 * Register a project alias mapping.
 *
 * @param db - Database instance
 * @param oldProject - The old folder-based project name
 * @param newProject - The new git-remote-based identifier
 * @returns true if new alias was created, false if already exists
 */
export function registerProjectAlias(
  db: Database,
  oldProject: string,
  newProject: string
): boolean {
  // Skip if old and new are the same
  if (oldProject === newProject) {
    return false;
  }

  try {
    const result = db.run(`
      INSERT OR IGNORE INTO project_aliases (old_project, new_project)
      VALUES (?, ?)
    `, [oldProject, newProject]);

    if (result.changes > 0) {
      logger.debug('PROJECT_ALIAS', 'Registered new alias', {
        old: oldProject,
        new: newProject
      });
      return true;
    }

    return false;
  } catch (error) {
    logger.error('PROJECT_ALIAS', 'Failed to register alias', {
      old: oldProject,
      new: newProject,
      error
    });
    return false;
  }
}

/**
 * Get all project identifiers that should be queried for a given project.
 *
 * IMPORTANT: Limited to MAX_ALIASES_IN_QUERY to avoid SQLite parameter limits.
 * If a project has more aliases, logs warning and returns truncated list.
 *
 * @param db - Database instance
 * @param project - The current project identifier
 * @returns Array of project identifiers including aliases
 */
export function getProjectsWithAliases(db: Database, project: string): string[] {
  const projects = [project];

  try {
    const aliases = db.query(`
      SELECT old_project FROM project_aliases
      WHERE new_project = ?
      LIMIT ?
    `).all(project, MAX_ALIASES_IN_QUERY) as { old_project: string }[];

    for (const alias of aliases) {
      projects.push(alias.old_project);
    }

    // Warn if we hit the limit
    if (aliases.length === MAX_ALIASES_IN_QUERY) {
      const totalCount = getAliasCount(db, project);
      if (totalCount > MAX_ALIASES_IN_QUERY) {
        logger.warn('PROJECT_ALIAS', 'Alias count exceeds query limit', {
          project,
          totalAliases: totalCount,
          includedInQuery: MAX_ALIASES_IN_QUERY,
          recommendation: 'Run cleanup to consolidate old aliases'
        });
      }
    }
  } catch (error) {
    logger.error('PROJECT_ALIAS', 'Failed to get aliases', { project, error });
  }

  return projects;
}

/**
 * Get count of aliases for a project.
 */
export function getAliasCount(db: Database, project: string): number {
  try {
    const result = db.query(`
      SELECT COUNT(*) as count FROM project_aliases WHERE new_project = ?
    `).get(project) as { count: number };
    return result.count;
  } catch {
    return 0;
  }
}

/**
 * Cleanup old aliases (for maintenance).
 * Removes aliases older than specified days.
 *
 * @param db - Database instance
 * @param olderThanDays - Delete aliases older than this many days (default: 365)
 * @returns Number of deleted rows
 */
export function cleanupOldAliases(db: Database, olderThanDays: number = 365): number {
  const cutoffEpoch = Math.floor(Date.now() / 1000) - (olderThanDays * 86400);

  try {
    const result = db.run(`
      DELETE FROM project_aliases WHERE created_at_epoch < ?
    `, [cutoffEpoch]);

    logger.info('PROJECT_ALIAS', 'Cleaned up old aliases', {
      deleted: result.changes,
      olderThanDays
    });

    return result.changes;
  } catch (error) {
    logger.error('PROJECT_ALIAS', 'Failed to cleanup aliases', { error });
    return 0;
  }
}
```

---

## Step 5: Run Tests (Should Pass)

```bash
bun test tests/sqlite/project-alias-resolution.test.ts
```

---

## Step 6: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-1.4.spec.md`.

---

## Step 7: Commit

```bash
git add src/services/sqlite/project-aliases.ts \
        tests/sqlite/project-alias-resolution.test.ts \
        docs/plans/agents/specs/task-1.4.spec.md
git commit -m "feat: add project alias resolution with hard cap and cleanup

- registerProjectAlias() for creating mappings
- getProjectsWithAliases() with MAX_ALIASES_IN_QUERY limit
- cleanupOldAliases() for maintenance
- Warning logged when limit exceeded

Part of #14"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-1.5-session-alias-registration.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 1.4 -->
## Context from Previous Agent

Tasks 1.1-1.4 are complete. The project alias system is now available:

```typescript
import {
  registerProjectAlias,
  getProjectsWithAliases,
  cleanupOldAliases,
  MAX_ALIASES_IN_QUERY
} from '../services/sqlite/project-aliases.js';

// Register: maps old basename to new git remote ID
registerProjectAlias(db, 'claude-mem', 'github.com/user/claude-mem');

// Query: get all identifiers for a project
const projects = getProjectsWithAliases(db, 'github.com/user/claude-mem');
// Returns: ['github.com/user/claude-mem', 'claude-mem']
```

Your task is to integrate this into session initialization, so aliases are
registered automatically when a session starts and the project name changes.

Tests passing: `bun test tests/sqlite/project-alias-resolution.test.ts`
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All tests pass
- [ ] MAX_ALIASES_IN_QUERY = 100
- [ ] Warning logged when limit exceeded
- [ ] Code committed
- [ ] Handoff comment added to task-1.5
