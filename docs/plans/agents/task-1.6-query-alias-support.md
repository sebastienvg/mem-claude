<!-- HANDOFF FROM TASK 1.5 -->
## Context from Previous Agent

Tasks 1.1-1.5 are complete. Session alias registration is now automatic:

1. When a session starts, `registerSessionAlias(db, cwd, project)` is called
2. If project ID is a git remote (contains '/'), registers basename as alias
3. This is non-blocking - session continues even on failure

Example:
- cwd: `/Users/seb/AI/claude-mem`
- Project ID: `github.com/sebastienvg/claude-mem`
- Alias registered: `claude-mem` -> `github.com/sebastienvg/claude-mem`

Your task is to update query functions to include aliases when searching.
Use `getProjectsWithAliases(db, project)` to get all project identifiers.

Tests passing: `bun test tests/hooks/session-alias.test.ts`
<!-- END HANDOFF -->

# Task 1.6: Update Query Functions for Alias Support

**Phase:** 1 - Git Repository Identification
**Issue:** #14
**Depends On:** Task 1.5 (session alias registration)
**Next Task:** `task-1.7-migration-cli.md`

---

## Objective

Update observation and session query functions to include project aliases when filtering by project. This ensures historical data (stored with folder basenames) is returned when querying with git remote identifiers.

---

## Files to Modify/Create

| File | Type |
|------|------|
| `src/services/sqlite/observations.ts` | Modify |
| `src/services/sqlite/session-summaries.ts` | Modify |
| `tests/sqlite/query-with-aliases.test.ts` | Create |
| `docs/plans/agents/specs/task-1.6.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-1.6.spec.md`:

```markdown
# Task 1.6 Specification: Query Functions with Alias Support

## Requirements

### Observation Queries
- [ ] `searchObservations()` includes project aliases in filter
- [ ] `getObservationsForContext()` includes project aliases
- [ ] Uses `getProjectsWithAliases()` to expand project filter
- [ ] Handles IN clause with multiple project values

### Session Summary Queries
- [ ] `getSessionSummaries()` includes project aliases
- [ ] `getLatestSessionSummary()` includes project aliases

### Query Pattern
```sql
-- Before:
WHERE project = ?

-- After:
WHERE project IN (?, ?, ?)  -- project + aliases
```

### Edge Cases
- [ ] Works when no aliases exist (single project value)
- [ ] Respects MAX_ALIASES_IN_QUERY limit
- [ ] Doesn't break when project_aliases table is empty

## Test Cases

### query-with-aliases.test.ts
- [ ] searchObservations returns data with old project name
- [ ] searchObservations returns data with new project name
- [ ] getObservationsForContext includes aliased data
- [ ] Query works when no aliases exist
- [ ] Query handles many aliases efficiently
```

---

## Step 2: Locate Query Functions

Find the observation and session query functions:
- `src/services/sqlite/observations.ts`
- `src/services/sqlite/session-summaries.ts`
- Or similar files containing search/query logic

Read to understand current query patterns.

---

## Step 3: Write Failing Tests

Create `tests/sqlite/query-with-aliases.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/services/sqlite/migrations.js';
import { registerProjectAlias } from '../../src/services/sqlite/project-aliases.js';
import {
  searchObservations,
  insertObservation
} from '../../src/services/sqlite/observations.js';

describe('Query Functions with Alias Support', () => {
  let db: Database;
  const newProjectId = 'github.com/user/my-repo';
  const oldProjectName = 'my-repo';

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);

    // Insert test observations with old project name
    insertObservation(db, {
      project: oldProjectName,
      session_id: 'test-session-1',
      type: 'discovery',
      title: 'Old Observation',
      narrative: 'This was created with folder basename',
      concepts: ['test'],
      files: [],
      tools: []
    });

    // Insert observation with new project ID
    insertObservation(db, {
      project: newProjectId,
      session_id: 'test-session-2',
      type: 'feature',
      title: 'New Observation',
      narrative: 'This was created with git remote ID',
      concepts: ['test'],
      files: [],
      tools: []
    });

    // Register alias
    registerProjectAlias(db, oldProjectName, newProjectId);
  });

  afterEach(() => {
    db.close();
  });

  describe('searchObservations', () => {
    it('should return observations with both old and new project names', () => {
      const results = searchObservations(db, {
        project: newProjectId,
        query: 'test'
      });

      // Should find both observations
      expect(results.length).toBeGreaterThanOrEqual(2);

      const titles = results.map(r => r.title);
      expect(titles).toContain('Old Observation');
      expect(titles).toContain('New Observation');
    });

    it('should work when querying with old project name', () => {
      // Query with old name should also find both via reverse lookup
      // (This may depend on implementation - adjust if needed)
      const results = searchObservations(db, {
        project: oldProjectName,
        query: 'test'
      });

      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('without aliases', () => {
    it('should work normally when no aliases exist', () => {
      const results = searchObservations(db, {
        project: 'unrelated-project',
        query: 'test'
      });

      expect(results).toHaveLength(0);
    });
  });
});
```

---

## Step 4: Update Query Functions

Modify observation queries to use aliases. Example pattern:

```typescript
// In src/services/sqlite/observations.ts

import { getProjectsWithAliases } from './project-aliases.js';

export function searchObservations(
  db: Database,
  options: SearchOptions
): Observation[] {
  const { project, query, limit = 50 } = options;

  // Expand project to include aliases
  const projects = getProjectsWithAliases(db, project);

  // Build parameterized IN clause
  const placeholders = projects.map(() => '?').join(', ');

  const sql = `
    SELECT * FROM observations
    WHERE project IN (${placeholders})
    AND (
      title LIKE ? OR
      narrative LIKE ?
    )
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `;

  const searchPattern = `%${query}%`;
  const params = [...projects, searchPattern, searchPattern, limit];

  return db.query(sql).all(...params) as Observation[];
}
```

Apply similar pattern to:
- `getObservationsForContext()`
- `getSessionSummaries()`
- `getLatestSessionSummary()`
- Any other project-filtered queries

---

## Step 5: Run Tests

```bash
bun test tests/sqlite/query-with-aliases.test.ts
```

---

## Step 6: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-1.6.spec.md`.

---

## Step 7: Commit

```bash
git add src/services/sqlite/observations.ts \
        src/services/sqlite/session-summaries.ts \
        tests/sqlite/query-with-aliases.test.ts \
        docs/plans/agents/specs/task-1.6.spec.md
git commit -m "feat: include project aliases in observation and session queries

- searchObservations() expands project filter with aliases
- getObservationsForContext() includes historical data
- getSessionSummaries() includes aliased sessions
- Enables seamless migration from folder to git remote IDs

Part of #14"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-1.7-migration-cli.md`

**Comment to add at top:**

```markdown
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
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All tests pass
- [ ] All project-filtered queries updated
- [ ] Historical data accessible via new project IDs
- [ ] Code committed
- [ ] Handoff comment added to task-1.7
