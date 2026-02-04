# Task 4.2 Specification: Maintenance CLI

## Commands

### `bun scripts/maintenance-cli.ts [--dry-run]`
- [x] Runs all cleanup tasks
- [x] --dry-run shows what would be deleted
- [x] Reports counts for each operation

### Options
- [x] --alias-max-age=365: Days before alias cleanup
- [x] --audit-max-age=90: Days before audit log cleanup
- [x] --dry-run: Preview without deleting

## Output Format
```
Claude-mem Maintenance Report
=============================

Aliases:
  - Total: 42
  - Older than 365 days: 5
  - [DRY RUN] Would delete: 5

Audit Logs:
  - Total: 1523
  - Older than 90 days: 234
  - [DRY RUN] Would delete: 234

Agents:
  - Total: 15
  - Verified: 12
  - Currently locked: 1
  - Expired keys: 3

Run without --dry-run to perform cleanup.
```

## Test Cases

### maintenance-command.test.ts
- [x] Dry run doesn't delete any records
- [x] Actual run deletes old aliases
- [x] Actual run deletes old audit logs
- [x] Reports correct counts for aliases
- [x] Reports correct counts for audit logs
- [x] Reports correct agent stats
- [x] Custom max age thresholds work correctly
- [x] formatMaintenanceReport produces correct output

## Implementation Notes

- CLI implemented as standalone script in `/scripts/maintenance-cli.ts`
- Core functions exported from `/src/cli/commands/maintenance.ts` for testability
- Uses `ClaudeMemDatabase` for database access
- Follows existing script patterns (e.g., `alias-cli.ts`)

## Files Created

| File | Purpose |
|------|---------|
| `src/cli/commands/maintenance.ts` | Core maintenance command functions |
| `scripts/maintenance-cli.ts` | CLI entry point |
| `tests/cli/maintenance-command.test.ts` | Unit tests (11 tests) |

## Database Tables Affected

- `project_aliases` - cleanup based on `created_at_epoch`
- `audit_log` - cleanup based on `created_at_epoch`
- `agents` - stats only (no deletion)

## Completion Date

Completed: 2026-02-03
