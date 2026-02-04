# Task 1.2 Specification: Update getProjectName

**Created:** 2026-02-03
**Status:** COMPLETE

## Requirements

### getProjectName(cwd: string | null | undefined)
- [x] Returns git remote identifier when available (via getGitRemoteIdentifier)
- [x] Falls back to folder basename when no git remote
- [x] Returns 'unknown-project' for empty/null cwd
- [x] Handles worktree directories (already supported via getProjectContext)

### Priority Order
1. Git remote URL (normalized) -> `github.com/user/repo`
2. Folder basename -> `my-project`
3. Fallback -> `unknown-project`

## Test Cases

### project-name.test.ts
- [x] Returns git remote identifier when available (mocked)
- [x] Falls back to basename when no git remote (mocked)
- [x] Returns 'unknown-project' for empty cwd
- [x] Returns 'unknown-project' for null cwd
- [x] Returns 'unknown-project' for undefined cwd
- [x] Handles trailing slashes and special characters
- [x] Integration: Returns valid identifier for current repo

## Dependencies

This task requires Task 1.1 utilities (also created as part of this task):
- `src/utils/git-available.ts`: `isGitAvailable()`, `resetGitAvailableCache()`
- `src/utils/git-remote.ts`: `normalizeGitUrl()`, `parseGitRemotes()`, `getPreferredRemote()`, `getGitRemoteIdentifier()`

## Implementation Notes

- Preserved existing `getProjectContext()` function
- Import `getGitRemoteIdentifier` from `./git-remote.js`
- Maintains backward compatibility with existing callers
- Added debug logging when using git remote identifier

## Files Modified/Created

| File | Type |
|------|------|
| `src/utils/git-available.ts` | Created |
| `src/utils/git-remote.ts` | Created |
| `src/utils/project-name.ts` | Modified |
| `tests/utils/git-available.test.ts` | Created |
| `tests/utils/git-remote.test.ts` | Created |
| `tests/utils/project-name.test.ts` | Created |
| `docs/plans/agents/specs/task-1.2.spec.md` | Created |

## Test Results

```
bun test v1.3.5
43 pass, 0 fail
56 expect() calls
Ran 43 tests across 3 files. [132.00ms]
```
