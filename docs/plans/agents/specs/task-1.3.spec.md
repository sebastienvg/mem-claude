# Task 1.3 Specification: Project Aliases Migration

**Created:** 2026-02-03
**Status:** COMPLETE

## Requirements

### Migration 022 - project_aliases table
- [x] Table name: `project_aliases`
- [x] Columns:
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT
  - `old_project` TEXT NOT NULL (the folder basename)
  - `new_project` TEXT NOT NULL (the git remote identifier)
  - `created_at` TEXT NOT NULL DEFAULT (datetime('now'))
  - `created_at_epoch` INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
- [x] Unique constraint on (old_project, new_project) pair
- [x] Index on `new_project` for reverse lookups
- [x] Index on `created_at_epoch` for cleanup queries
- [x] Migration is idempotent (uses IF NOT EXISTS)

## Test Cases

### project-aliases-migration.test.ts
- [x] Migration creates project_aliases table
- [x] Can insert alias mapping
- [x] Unique constraint prevents duplicates
- [x] Allows same old_project with different new_project (fork scenario)
- [x] Allows same new_project with different old_project (multiple checkout paths)
- [x] Can query aliases by new_project
- [x] Can query aliases by old_project
- [x] created_at and created_at_epoch are auto-populated

## Implementation Notes

- Migration version 22 (after createMultiAgentTables at version 21)
- Follows existing MigrationRunner pattern in `src/services/sqlite/migrations/runner.ts`
- Uses idempotent checks before creating table/indexes
- Table maps old folder-based names to new git-remote-based identifiers

## Files Modified/Created

| File | Type |
|------|------|
| `src/services/sqlite/migrations/runner.ts` | Modified |
| `tests/sqlite/project-aliases-migration.test.ts` | Created |
| `docs/plans/agents/specs/task-1.3.spec.md` | Created |

## Test Results

```
bun test v1.3.5
13 pass, 0 fail
26 expect() calls
Ran 13 tests across 1 file. [59.00ms]
```
