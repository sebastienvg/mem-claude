# Task 1.7 Specification: Migration CLI Commands

## Commands

### `bun scripts/alias-cli.ts list [project]`
- [x] Lists all aliases
- [x] Optional: filter by project
- [x] Shows old_project, new_project, created_at
- [x] Sorted by created_at descending

### `bun scripts/alias-cli.ts add <old> <new>`
- [x] Registers alias manually
- [x] Validates project names
- [x] Reports if alias already exists

### `bun scripts/alias-cli.ts cleanup [--days=365] [--dry-run]`
- [x] Deletes aliases older than specified days
- [x] --dry-run shows what would be deleted
- [x] Reports number of deleted/would-be-deleted aliases

### `bun scripts/alias-cli.ts count <project>`
- [x] Shows count of aliases for a project
- [x] Warns if count exceeds MAX_ALIASES_IN_QUERY

## Test Cases

### alias-command.test.ts
- [x] list: Shows all aliases
- [x] list: Filters by project
- [x] add: Creates new alias
- [x] add: Reports duplicate
- [x] cleanup: Deletes old aliases
- [x] cleanup: Dry run doesn't delete
- [x] count: Shows correct count
- [x] count: Warns when exceeding limit

## Implementation Notes

- CLI implemented as standalone script in `/scripts/alias-cli.ts`
- Core functions exported from `/src/cli/commands/alias.ts` for testability
- Uses `ClaudeMemDatabase` for database access
- Follows existing script patterns (e.g., `check-pending-queue.ts`)

## Files Created

| File | Purpose |
|------|---------|
| `src/cli/commands/alias.ts` | Core alias command functions |
| `scripts/alias-cli.ts` | CLI entry point |
| `tests/cli/alias-command.test.ts` | Unit tests |

## Completion Date

Completed: 2026-02-03
