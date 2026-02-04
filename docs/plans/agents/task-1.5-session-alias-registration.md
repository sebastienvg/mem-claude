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

# Task 1.5: Update Session Init to Register Aliases

**Phase:** 1 - Git Repository Identification
**Issue:** #14
**Depends On:** Task 1.4 (project alias service)
**Next Task:** `task-1.6-query-alias-support.md`

---

## Objective

Integrate alias registration into session initialization. When a session starts, detect if the project identifier has changed from basename to git remote, and register the alias mapping.

---

## Files to Modify/Create

| File | Type |
|------|------|
| `src/hooks/session-start.ts` (or equivalent) | Modify |
| `tests/hooks/session-start-alias.test.ts` | Create |
| `docs/plans/agents/specs/task-1.5.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-1.5.spec.md`:

```markdown
# Task 1.5 Specification: Session Alias Registration

## Requirements

### Session Start Hook Enhancement
- [ ] Detect current project name using getProjectName()
- [ ] If project name is a git remote ID, also compute the basename fallback
- [ ] If basename differs from git remote ID, register alias
- [ ] Handle cases where project has no git remote (no alias needed)
- [ ] Registration should be non-blocking (don't fail session if alias registration fails)

### Logic Flow
```
1. Get cwd from environment
2. Get project name (git remote or basename)
3. If project name looks like git remote (contains '/'):
   a. Compute basename from cwd
   b. If basename != project name:
      - Register alias(basename -> project name)
4. Continue with normal session init
```

## Test Cases

### session-start-alias.test.ts
- [ ] Registers alias when project has git remote
- [ ] Does not register alias when basename equals project name
- [ ] Handles missing cwd gracefully
- [ ] Does not block session on registration failure
```

---

## Step 2: Locate Session Initialization Code

Find where session initialization happens. Common locations:
- `src/hooks/session-start.ts`
- `src/hooks/session-start-hook.ts`
- `src/services/worker/session.ts`

Read the file to understand the current flow.

---

## Step 3: Write Failing Tests

Create `tests/hooks/session-start-alias.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/services/sqlite/migrations.js';
import * as projectName from '../../src/utils/project-name.js';
import * as projectAliases from '../../src/services/sqlite/project-aliases.js';
import path from 'path';

// Mock the session alias registration function (to be implemented)
import { registerSessionAlias } from '../../src/hooks/session-alias.js';

describe('Session Alias Registration', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should register alias when project has git remote', () => {
    const cwd = '/Users/user/projects/my-repo';
    const gitRemoteId = 'github.com/user/my-repo';

    const projectNameSpy = spyOn(projectName, 'getProjectName')
      .mockReturnValue(gitRemoteId);

    const registerSpy = spyOn(projectAliases, 'registerProjectAlias')
      .mockReturnValue(true);

    registerSessionAlias(db, cwd);

    expect(registerSpy).toHaveBeenCalledWith(db, 'my-repo', gitRemoteId);

    projectNameSpy.mockRestore();
    registerSpy.mockRestore();
  });

  it('should not register alias when basename equals project name', () => {
    const cwd = '/Users/user/projects/my-local-project';
    const projectNameValue = 'my-local-project'; // No git remote

    const projectNameSpy = spyOn(projectName, 'getProjectName')
      .mockReturnValue(projectNameValue);

    const registerSpy = spyOn(projectAliases, 'registerProjectAlias');

    registerSessionAlias(db, cwd);

    // Should not call register since names are the same
    expect(registerSpy).not.toHaveBeenCalled();

    projectNameSpy.mockRestore();
    registerSpy.mockRestore();
  });

  it('should handle missing cwd gracefully', () => {
    expect(() => registerSessionAlias(db, '')).not.toThrow();
    expect(() => registerSessionAlias(db, null as any)).not.toThrow();
  });

  it('should not throw on registration failure', () => {
    const cwd = '/Users/user/projects/my-repo';
    const gitRemoteId = 'github.com/user/my-repo';

    const projectNameSpy = spyOn(projectName, 'getProjectName')
      .mockReturnValue(gitRemoteId);

    const registerSpy = spyOn(projectAliases, 'registerProjectAlias')
      .mockImplementation(() => { throw new Error('DB error'); });

    // Should not throw
    expect(() => registerSessionAlias(db, cwd)).not.toThrow();

    projectNameSpy.mockRestore();
    registerSpy.mockRestore();
  });
});
```

---

## Step 4: Implement Session Alias Registration

Create `src/hooks/session-alias.ts`:

```typescript
import { Database } from 'bun:sqlite';
import path from 'path';
import { getProjectName } from '../utils/project-name.js';
import { registerProjectAlias } from '../services/sqlite/project-aliases.js';
import { logger } from '../utils/logger.js';

/**
 * Register project alias during session initialization.
 *
 * If the current project is identified by git remote, also register
 * the folder basename as an alias for backwards compatibility.
 *
 * @param db - Database instance
 * @param cwd - Current working directory
 */
export function registerSessionAlias(db: Database, cwd: string | null | undefined): void {
  if (!cwd) {
    return;
  }

  try {
    const projectId = getProjectName(cwd);
    const basename = path.basename(cwd);

    // If project ID is different from basename, it's likely a git remote ID
    // Register the basename as an alias for backwards compatibility
    if (projectId && basename && projectId !== basename) {
      const isNew = registerProjectAlias(db, basename, projectId);
      if (isNew) {
        logger.debug('SESSION', 'Registered project alias', {
          basename,
          projectId
        });
      }
    }
  } catch (error) {
    // Non-blocking: don't fail session if alias registration fails
    logger.warn('SESSION', 'Failed to register project alias', {
      cwd,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
```

---

## Step 5: Integrate into Session Start Hook

Modify the session start hook to call `registerSessionAlias`:

```typescript
// In session-start.ts or equivalent

import { registerSessionAlias } from './session-alias.js';

// In the session initialization function:
async function handleSessionStart(payload: SessionStartPayload): Promise<void> {
  const db = getDatabase();
  const cwd = payload.cwd || process.env.CLAUDE_PROJECT_ROOT;

  // Register alias for backwards compatibility
  registerSessionAlias(db, cwd);

  // ... rest of session initialization
}
```

---

## Step 6: Run Tests

```bash
bun test tests/hooks/session-start-alias.test.ts
```

---

## Step 7: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-1.5.spec.md`.

---

## Step 8: Commit

```bash
git add src/hooks/session-alias.ts \
        tests/hooks/session-start-alias.test.ts \
        docs/plans/agents/specs/task-1.5.spec.md \
        src/hooks/session-start.ts  # or wherever integration was added
git commit -m "feat: register project aliases on session start

- Auto-register basename as alias when git remote ID is used
- Non-blocking: session continues even if registration fails
- Enables backwards compatibility with existing observations

Part of #14"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-1.6-query-alias-support.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 1.5 -->
## Context from Previous Agent

Tasks 1.1-1.5 are complete. Session alias registration is now automatic:

1. When a session starts, `registerSessionAlias(db, cwd)` is called
2. If project ID is a git remote (contains '/'), registers basename as alias
3. This is non-blocking - session continues even on failure

Example:
- cwd: `/Users/seb/AI/claude-mem`
- Project ID: `github.com/sebastienvg/claude-mem`
- Alias registered: `claude-mem` → `github.com/sebastienvg/claude-mem`

Your task is to update query functions to include aliases when searching.
Use `getProjectsWithAliases(db, project)` to get all project identifiers.

Tests passing: `bun test tests/hooks/session-start-alias.test.ts`
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All tests pass
- [ ] Integration added to session start hook
- [ ] Non-blocking error handling
- [ ] Code committed
- [ ] Handoff comment added to task-1.6
