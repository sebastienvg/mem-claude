# Task 1.2: Update getProjectName to Use Git Remote

**Phase:** 1 - Git Repository Identification
**Issue:** #14
**Depends On:** Task 1.1 (git-remote utilities)
**Next Task:** `task-1.3-project-aliases-migration.md`

---

## Objective

Update `getProjectName()` to prioritize git remote URL over folder basename, enabling portable project identification across machines and worktrees.

---

## Files to Modify/Create

| File | Type |
|------|------|
| `src/utils/project-name.ts` | Modify |
| `tests/utils/project-name.test.ts` | Create |
| `docs/plans/agents/specs/task-1.2.spec.md` | Create |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-1.2.spec.md`:

```markdown
# Task 1.2 Specification: Update getProjectName

## Requirements

### getProjectName(cwd: string | null | undefined)
- [ ] Returns git remote identifier when available (via getGitRemoteIdentifier)
- [ ] Falls back to folder basename when no git remote
- [ ] Returns 'unknown-project' for empty/null cwd
- [ ] Handles worktree directories (already supported)

### Priority Order
1. Git remote URL (normalized) → `github.com/user/repo`
2. Folder basename → `my-project`
3. Fallback → `unknown-project`

## Test Cases

### project-name.test.ts
- [ ] Returns git remote identifier when available (mocked)
- [ ] Falls back to basename when no git remote (mocked)
- [ ] Returns 'unknown-project' for empty cwd
- [ ] Returns 'unknown-project' for null cwd
- [ ] Integration: Returns valid identifier for current repo
```

---

## Step 2: Read Current Implementation

First, read the current `src/utils/project-name.ts` to understand the existing structure.

---

## Step 3: Write Failing Tests

Create `tests/utils/project-name.test.ts`:

```typescript
import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { getProjectName } from '../../src/utils/project-name.js';
import * as gitRemote from '../../src/utils/git-remote.js';

describe('Project Name Utilities', () => {
  describe('getProjectName', () => {
    afterEach(() => {
      // Restore any spies
    });

    it('should return git remote identifier when available', () => {
      const spy = spyOn(gitRemote, 'getGitRemoteIdentifier')
        .mockReturnValue('github.com/user/repo');

      const result = getProjectName('/some/path/repo');
      expect(result).toBe('github.com/user/repo');

      spy.mockRestore();
    });

    it('should fall back to basename when no git remote', () => {
      const spy = spyOn(gitRemote, 'getGitRemoteIdentifier')
        .mockReturnValue(null);

      const result = getProjectName('/some/path/my-project');
      expect(result).toBe('my-project');

      spy.mockRestore();
    });

    it('should return unknown-project for empty cwd', () => {
      expect(getProjectName('')).toBe('unknown-project');
    });

    it('should return unknown-project for null cwd', () => {
      expect(getProjectName(null as any)).toBe('unknown-project');
    });

    it('should return valid identifier for current repo (integration)', () => {
      const result = getProjectName(process.cwd());
      // Should be either a git remote or the folder name
      expect(result).toBeTruthy();
      expect(result).not.toBe('unknown-project');
    });
  });
});
```

---

## Step 4: Run Tests (Should Fail)

```bash
bun test tests/utils/project-name.test.ts
```

---

## Step 5: Update Implementation

Modify `src/utils/project-name.ts`:

```typescript
import path from 'path';
import { getGitRemoteIdentifier } from './git-remote.js';

/**
 * Get project name from the current working directory.
 *
 * Priority:
 * 1. Git remote URL (normalized) → 'github.com/user/repo'
 * 2. Folder basename → 'my-project'
 * 3. Fallback → 'unknown-project'
 *
 * @param cwd - Current working directory path
 * @returns Project identifier
 */
export function getProjectName(cwd: string | null | undefined): string {
  if (!cwd || cwd.trim() === '') {
    return 'unknown-project';
  }

  // Try git remote first (portable across machines)
  const remoteId = getGitRemoteIdentifier(cwd);
  if (remoteId) {
    return remoteId;
  }

  // Fall back to folder basename
  const basename = path.basename(cwd);
  return basename || 'unknown-project';
}

// Keep existing getProjectContext function if present
// ...
```

**Important:** Preserve any existing functions like `getProjectContext()` that may already exist in the file.

---

## Step 6: Run Tests (Should Pass)

```bash
bun test tests/utils/project-name.test.ts
```

---

## Step 7: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-1.2.spec.md`.

---

## Step 8: Commit

```bash
git add src/utils/project-name.ts tests/utils/project-name.test.ts \
        docs/plans/agents/specs/task-1.2.spec.md
git commit -m "feat: prioritize git remote URL for project identification

- getProjectName() now returns git remote ID when available
- Falls back to folder basename for local-only repos
- Returns 'unknown-project' for invalid paths

Part of #14"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-1.3-project-aliases-migration.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 1.2 -->
## Context from Previous Agent

Tasks 1.1 and 1.2 are complete. Project identification now works as follows:

1. `getProjectName(cwd)` returns git remote identifier (e.g., `github.com/user/repo`)
2. Falls back to folder basename if no git remote
3. Returns `'unknown-project'` for invalid paths

**Important for migration:** Existing observations use folder basenames (e.g., `claude-mem`).
The new system will produce git remote IDs (e.g., `github.com/sebastienvg/claude-mem`).

The project_aliases table must map old → new to preserve data continuity.

Tests passing: `bun test tests/utils/project-name.test.ts`
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All tests pass
- [ ] Existing getProjectContext() preserved (if present)
- [ ] Code committed
- [ ] Handoff comment added to task-1.3
