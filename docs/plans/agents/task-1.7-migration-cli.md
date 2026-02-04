<!-- HANDOFF FROM TASK 1.6 -->
## Context from Previous Agent

Tasks 1.1-1.6 are complete. The project alias system is fully functional:

1. **Identification**: `getProjectName()` returns git remote ID or falls back to basename
2. **Registration**: `registerSessionAlias()` auto-registers on session start
3. **Resolution**: `getProjectsWithAliases()` expands project to include aliases
4. **Queries**: All observation/session queries now include aliases

Querying `github.com/user/repo` will also return data stored under `repo`.

Your task is to create a CLI command for manual alias migration and cleanup.
This allows users to:
- Manually register aliases
- View existing aliases
- Clean up old aliases

Tests passing: `bun test tests/sqlite/query-with-aliases.test.ts`
<!-- END HANDOFF -->

# Task 1.7: Add Migration CLI Command

**Phase:** 1 - Git Repository Identification
**Issue:** #14
**Depends On:** Task 1.6
**Next Task:** `task-2.1-agents-table-migration.md` (Phase 2)

---

## Objective

Create CLI commands for managing project aliases: manual registration, listing, and cleanup. This provides operators with tools to manage the migration and maintain the alias table.

---

## Files to Create/Modify

| File | Type |
|------|------|
| `src/cli/commands/alias.ts` | Create |
| `src/cli/index.ts` | Modify (add command) |
| `tests/cli/alias-command.test.ts` | Create |
| `docs/plans/agents/specs/task-1.7.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-1.7.spec.md`:

```markdown
# Task 1.7 Specification: Migration CLI Commands

## Commands

### `claude-mem alias list [project]`
- [ ] Lists all aliases
- [ ] Optional: filter by project
- [ ] Shows old_project, new_project, created_at
- [ ] Sorted by created_at descending

### `claude-mem alias add <old> <new>`
- [ ] Registers alias manually
- [ ] Validates project names
- [ ] Reports if alias already exists

### `claude-mem alias cleanup [--days=365] [--dry-run]`
- [ ] Deletes aliases older than specified days
- [ ] --dry-run shows what would be deleted
- [ ] Reports number of deleted/would-be-deleted aliases

### `claude-mem alias count <project>`
- [ ] Shows count of aliases for a project
- [ ] Warns if count exceeds MAX_ALIASES_IN_QUERY

## Test Cases

### alias-command.test.ts
- [ ] list: Shows all aliases
- [ ] list: Filters by project
- [ ] add: Creates new alias
- [ ] add: Reports duplicate
- [ ] cleanup: Deletes old aliases
- [ ] cleanup: Dry run doesn't delete
- [ ] count: Shows correct count
```

---

## Step 2: Write Failing Tests

Create `tests/cli/alias-command.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/services/sqlite/migrations.js';
import {
  listAliases,
  addAlias,
  cleanupAliases,
  countAliases
} from '../../src/cli/commands/alias.js';

describe('Alias CLI Commands', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    // Seed test data
    db.run(`
      INSERT INTO project_aliases (old_project, new_project)
      VALUES
        ('proj-a', 'github.com/user/repo'),
        ('proj-b', 'github.com/user/repo'),
        ('other', 'github.com/other/repo')
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe('listAliases', () => {
    it('should list all aliases', () => {
      const result = listAliases(db);

      expect(result.aliases).toHaveLength(3);
    });

    it('should filter by project', () => {
      const result = listAliases(db, 'github.com/user/repo');

      expect(result.aliases).toHaveLength(2);
      expect(result.aliases.every(a => a.new_project === 'github.com/user/repo')).toBe(true);
    });
  });

  describe('addAlias', () => {
    it('should create new alias', () => {
      const result = addAlias(db, 'new-name', 'github.com/user/new-repo');

      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
    });

    it('should report duplicate', () => {
      const result = addAlias(db, 'proj-a', 'github.com/user/repo');

      expect(result.success).toBe(true);
      expect(result.created).toBe(false);
      expect(result.message).toContain('already exists');
    });
  });

  describe('cleanupAliases', () => {
    it('should delete old aliases', () => {
      // Insert old alias
      const oldEpoch = Math.floor(Date.now() / 1000) - (400 * 86400);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
        VALUES ('ancient', 'github.com/old/repo', ?)
      `, [oldEpoch]);

      const result = cleanupAliases(db, { days: 365, dryRun: false });

      expect(result.deleted).toBe(1);
    });

    it('should not delete on dry run', () => {
      const oldEpoch = Math.floor(Date.now() / 1000) - (400 * 86400);
      db.run(`
        INSERT INTO project_aliases (old_project, new_project, created_at_epoch)
        VALUES ('ancient', 'github.com/old/repo', ?)
      `, [oldEpoch]);

      const result = cleanupAliases(db, { days: 365, dryRun: true });

      expect(result.wouldDelete).toBe(1);
      expect(result.deleted).toBe(0);

      // Verify still exists
      const count = db.query(`SELECT COUNT(*) as c FROM project_aliases WHERE old_project = 'ancient'`).get() as { c: number };
      expect(count.c).toBe(1);
    });
  });

  describe('countAliases', () => {
    it('should show correct count', () => {
      const result = countAliases(db, 'github.com/user/repo');

      expect(result.count).toBe(2);
      expect(result.exceedsLimit).toBe(false);
    });
  });
});
```

---

## Step 3: Run Tests (Should Fail)

```bash
bun test tests/cli/alias-command.test.ts
```

---

## Step 4: Implement CLI Commands

Create `src/cli/commands/alias.ts`:

```typescript
import { Database } from 'bun:sqlite';
import {
  registerProjectAlias,
  getAliasCount,
  cleanupOldAliases,
  MAX_ALIASES_IN_QUERY
} from '../../services/sqlite/project-aliases.js';

export interface Alias {
  id: number;
  old_project: string;
  new_project: string;
  created_at: string;
}

export interface ListResult {
  aliases: Alias[];
  total: number;
}

export interface AddResult {
  success: boolean;
  created: boolean;
  message: string;
}

export interface CleanupResult {
  deleted: number;
  wouldDelete: number;
  dryRun: boolean;
}

export interface CountResult {
  project: string;
  count: number;
  exceedsLimit: boolean;
  limit: number;
}

/**
 * List all project aliases, optionally filtered by project.
 */
export function listAliases(db: Database, project?: string): ListResult {
  let sql = `
    SELECT id, old_project, new_project, created_at
    FROM project_aliases
  `;
  const params: any[] = [];

  if (project) {
    sql += ` WHERE new_project = ?`;
    params.push(project);
  }

  sql += ` ORDER BY created_at DESC`;

  const aliases = db.query(sql).all(...params) as Alias[];

  return {
    aliases,
    total: aliases.length
  };
}

/**
 * Add a new project alias.
 */
export function addAlias(db: Database, oldProject: string, newProject: string): AddResult {
  if (!oldProject || !newProject) {
    return {
      success: false,
      created: false,
      message: 'Both old and new project names are required'
    };
  }

  if (oldProject === newProject) {
    return {
      success: false,
      created: false,
      message: 'Old and new project names must be different'
    };
  }

  const created = registerProjectAlias(db, oldProject, newProject);

  return {
    success: true,
    created,
    message: created
      ? `Alias created: ${oldProject} → ${newProject}`
      : `Alias already exists: ${oldProject} → ${newProject}`
  };
}

/**
 * Cleanup old aliases.
 */
export function cleanupAliases(
  db: Database,
  options: { days: number; dryRun: boolean }
): CleanupResult {
  const { days, dryRun } = options;
  const cutoffEpoch = Math.floor(Date.now() / 1000) - (days * 86400);

  // Count what would be deleted
  const countResult = db.query(`
    SELECT COUNT(*) as count FROM project_aliases WHERE created_at_epoch < ?
  `).get(cutoffEpoch) as { count: number };

  if (dryRun) {
    return {
      deleted: 0,
      wouldDelete: countResult.count,
      dryRun: true
    };
  }

  const deleted = cleanupOldAliases(db, days);

  return {
    deleted,
    wouldDelete: 0,
    dryRun: false
  };
}

/**
 * Count aliases for a project.
 */
export function countAliases(db: Database, project: string): CountResult {
  const count = getAliasCount(db, project);

  return {
    project,
    count,
    exceedsLimit: count > MAX_ALIASES_IN_QUERY,
    limit: MAX_ALIASES_IN_QUERY
  };
}

/**
 * Format alias list for display.
 */
export function formatAliasList(result: ListResult): string {
  if (result.aliases.length === 0) {
    return 'No aliases found.';
  }

  const lines = [
    `Found ${result.total} alias(es):`,
    '',
    'OLD PROJECT → NEW PROJECT (created)',
    '─'.repeat(60)
  ];

  for (const alias of result.aliases) {
    lines.push(`${alias.old_project} → ${alias.new_project} (${alias.created_at})`);
  }

  return lines.join('\n');
}
```

---

## Step 5: Register Commands in CLI

Modify `src/cli/index.ts` (or equivalent CLI entry point):

```typescript
import { Command } from 'commander';
import {
  listAliases,
  addAlias,
  cleanupAliases,
  countAliases,
  formatAliasList
} from './commands/alias.js';
import { openDatabase } from '../services/sqlite/database.js';

const program = new Command();

const aliasCmd = program
  .command('alias')
  .description('Manage project aliases');

aliasCmd
  .command('list [project]')
  .description('List all aliases, optionally filtered by project')
  .action((project?: string) => {
    const db = openDatabase();
    const result = listAliases(db, project);
    console.log(formatAliasList(result));
    db.close();
  });

aliasCmd
  .command('add <old> <new>')
  .description('Add a new project alias')
  .action((oldProject: string, newProject: string) => {
    const db = openDatabase();
    const result = addAlias(db, oldProject, newProject);
    console.log(result.message);
    db.close();
    process.exit(result.success ? 0 : 1);
  });

aliasCmd
  .command('cleanup')
  .description('Remove old aliases')
  .option('-d, --days <days>', 'Delete aliases older than N days', '365')
  .option('--dry-run', 'Show what would be deleted without deleting')
  .action((options) => {
    const db = openDatabase();
    const result = cleanupAliases(db, {
      days: parseInt(options.days, 10),
      dryRun: options.dryRun ?? false
    });

    if (result.dryRun) {
      console.log(`[DRY RUN] Would delete ${result.wouldDelete} alias(es)`);
    } else {
      console.log(`Deleted ${result.deleted} alias(es)`);
    }
    db.close();
  });

aliasCmd
  .command('count <project>')
  .description('Count aliases for a project')
  .action((project: string) => {
    const db = openDatabase();
    const result = countAliases(db, project);

    console.log(`Project: ${result.project}`);
    console.log(`Aliases: ${result.count}`);

    if (result.exceedsLimit) {
      console.warn(`⚠️  Exceeds query limit of ${result.limit}. Consider cleanup.`);
    }
    db.close();
  });
```

---

## Step 6: Run Tests

```bash
bun test tests/cli/alias-command.test.ts
```

---

## Step 7: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-1.7.spec.md`.

---

## Step 8: Commit

```bash
git add src/cli/commands/alias.ts \
        src/cli/index.ts \
        tests/cli/alias-command.test.ts \
        docs/plans/agents/specs/task-1.7.spec.md
git commit -m "feat: add CLI commands for project alias management

- claude-mem alias list [project]: List all aliases
- claude-mem alias add <old> <new>: Register alias manually
- claude-mem alias cleanup [--days=365] [--dry-run]: Remove old aliases
- claude-mem alias count <project>: Show alias count with limit warning

Part of #14"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-2.1-agents-table-migration.md`

**Comment to add at top:**

```markdown
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
   - `registerProjectAlias()`: Maps old → new project names
   - `getProjectsWithAliases()`: Expands project for queries
   - `cleanupOldAliases()`: Maintenance function

4. **Session Integration** (`src/hooks/session-alias.ts`)
   - Auto-registers aliases on session start

5. **Query Updates**
   - All project-filtered queries now include aliases

6. **CLI Commands**
   - `claude-mem alias list/add/cleanup/count`

### Ready for Phase 2

Phase 2 implements multi-agent architecture. The project identification system
is now stable and can be relied upon for agent scoping.

Tests passing: All Phase 1 tests
<!-- END HANDOFF -->
```

---

## Phase 1 Complete!

This completes Phase 1 of the implementation plan. Phase 2 begins with multi-agent architecture.

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All tests pass
- [ ] CLI commands work end-to-end
- [ ] Code committed
- [ ] Handoff comment added to task-2.1
