<!-- HANDOFF FROM TASK 4.1 -->
## Context from Previous Agent

Task 4.1 is complete.

**Prefix collision handling implemented:**
- Added warning log when prefix matches but hash does not match
- Log includes candidate agent ID and probability note
- Probability: ~1 in 2^48 (acceptable for <10K agents)
- Future: Add composite index if scale increases beyond 10K agents

**Files modified:**
- `src/services/agents/AgentService.ts` - Added warning log in `findAgentByKey()`
- `tests/services/agents/agent-service.test.ts` - Added 2 new tests for prefix collision warning

**Tests added:**
- `should log warning on prefix match with hash mismatch (prefix collision detection)`
- `should still create audit log entry after prefix collision warning`

Your task is to add maintenance CLI commands for cleanup operations.
<!-- END HANDOFF -->

# Task 4.2: Add Maintenance CLI Commands (Optional)

**Phase:** 4 - Polish & Maintenance (Optional)
**Issue:** #15
**Depends On:** Task 4.1
**Next Task:** `task-4.3-metrics-endpoint.md`

---

## Status: OPTIONAL

This task adds operational convenience and is not required for release.

---

## Objective

Create CLI commands for periodic maintenance: cleaning up old aliases, pruning audit logs, and showing system health.

---

## Files to Create

| File | Type |
|------|------|
| `src/cli/commands/maintenance.ts` | Implementation |
| `tests/cli/maintenance.test.ts` | Tests |
| `docs/plans/agents/specs/task-4.2.spec.md` | Specification |

---

## Specification

Create `docs/plans/agents/specs/task-4.2.spec.md`:

```markdown
# Task 4.2 Specification: Maintenance CLI

## Commands

### claude-mem maintenance [--dry-run]
- [ ] Runs all cleanup tasks
- [ ] --dry-run shows what would be deleted
- [ ] Reports counts for each operation

### Options
- [ ] --alias-max-age=365: Days before alias cleanup
- [ ] --audit-max-age=90: Days before audit log cleanup
- [ ] --dry-run: Preview without deleting

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
  - Locked: 1
  - Expired keys: 3

Run without --dry-run to perform cleanup.
```

## Test Cases
- [ ] Dry run doesn't delete
- [ ] Actual run deletes old records
- [ ] Reports correct counts
```

---

## Implementation

Create `src/cli/commands/maintenance.ts`:

```typescript
import { Database } from 'bun:sqlite';
import { cleanupOldAliases, getAliasCount } from '../../services/sqlite/project-aliases.js';
import { logger } from '../../utils/logger.js';

export interface MaintenanceOptions {
  aliasMaxAgeDays: number;
  auditMaxAgeDays: number;
  dryRun: boolean;
}

export interface MaintenanceReport {
  aliases: {
    total: number;
    olderThan: number;
    deleted: number;
  };
  auditLogs: {
    total: number;
    olderThan: number;
    deleted: number;
  };
  agents: {
    total: number;
    verified: number;
    locked: number;
    expiredKeys: number;
  };
  dryRun: boolean;
}

export async function runMaintenance(
  db: Database,
  options: MaintenanceOptions
): Promise<MaintenanceReport> {
  const { aliasMaxAgeDays, auditMaxAgeDays, dryRun } = options;
  const now = Math.floor(Date.now() / 1000);

  // Alias stats
  const aliasTotal = (db.query(`SELECT COUNT(*) as c FROM project_aliases`).get() as any).c;
  const aliasCutoff = now - (aliasMaxAgeDays * 86400);
  const aliasOld = (db.query(`SELECT COUNT(*) as c FROM project_aliases WHERE created_at_epoch < ?`).get(aliasCutoff) as any).c;

  // Audit log stats
  const auditTotal = (db.query(`SELECT COUNT(*) as c FROM audit_log`).get() as any).c;
  const auditCutoff = now - (auditMaxAgeDays * 86400);
  const auditOld = (db.query(`SELECT COUNT(*) as c FROM audit_log WHERE created_at_epoch < ?`).get(auditCutoff) as any).c;

  // Agent stats
  const agentTotal = (db.query(`SELECT COUNT(*) as c FROM agents`).get() as any).c;
  const agentVerified = (db.query(`SELECT COUNT(*) as c FROM agents WHERE verified = 1`).get() as any).c;
  const agentLocked = (db.query(`SELECT COUNT(*) as c FROM agents WHERE locked_until_epoch > ?`).get(now) as any).c;
  const agentExpired = (db.query(`SELECT COUNT(*) as c FROM agents WHERE expires_at_epoch < ? AND expires_at_epoch IS NOT NULL`).get(now) as any).c;

  let aliasDeleted = 0;
  let auditDeleted = 0;

  if (!dryRun) {
    // Delete old aliases
    const aliasResult = db.run(`DELETE FROM project_aliases WHERE created_at_epoch < ?`, [aliasCutoff]);
    aliasDeleted = aliasResult.changes;

    // Delete old audit logs
    const auditResult = db.run(`DELETE FROM audit_log WHERE created_at_epoch < ?`, [auditCutoff]);
    auditDeleted = auditResult.changes;

    logger.info('MAINTENANCE', 'Cleanup completed', {
      aliasDeleted,
      auditDeleted
    });
  }

  return {
    aliases: {
      total: aliasTotal,
      olderThan: aliasOld,
      deleted: dryRun ? 0 : aliasDeleted
    },
    auditLogs: {
      total: auditTotal,
      olderThan: auditOld,
      deleted: dryRun ? 0 : auditDeleted
    },
    agents: {
      total: agentTotal,
      verified: agentVerified,
      locked: agentLocked,
      expiredKeys: agentExpired
    },
    dryRun
  };
}

export function formatMaintenanceReport(report: MaintenanceReport): string {
  const lines = [
    'Claude-mem Maintenance Report',
    '=============================',
    '',
    'Aliases:',
    `  - Total: ${report.aliases.total}`,
    `  - Older than threshold: ${report.aliases.olderThan}`,
  ];

  if (report.dryRun) {
    lines.push(`  - [DRY RUN] Would delete: ${report.aliases.olderThan}`);
  } else {
    lines.push(`  - Deleted: ${report.aliases.deleted}`);
  }

  lines.push(
    '',
    'Audit Logs:',
    `  - Total: ${report.auditLogs.total}`,
    `  - Older than threshold: ${report.auditLogs.olderThan}`,
  );

  if (report.dryRun) {
    lines.push(`  - [DRY RUN] Would delete: ${report.auditLogs.olderThan}`);
  } else {
    lines.push(`  - Deleted: ${report.auditLogs.deleted}`);
  }

  lines.push(
    '',
    'Agents:',
    `  - Total: ${report.agents.total}`,
    `  - Verified: ${report.agents.verified}`,
    `  - Currently locked: ${report.agents.locked}`,
    `  - Expired keys: ${report.agents.expiredKeys}`,
  );

  if (report.dryRun) {
    lines.push('', 'Run without --dry-run to perform cleanup.');
  }

  return lines.join('\n');
}
```

---

## CLI Integration

Add to CLI entry point:

```typescript
program
  .command('maintenance')
  .description('Run maintenance tasks')
  .option('--alias-max-age <days>', 'Max age for aliases in days', '365')
  .option('--audit-max-age <days>', 'Max age for audit logs in days', '90')
  .option('--dry-run', 'Preview without deleting')
  .action(async (options) => {
    const db = openDatabase();
    const report = await runMaintenance(db, {
      aliasMaxAgeDays: parseInt(options.aliasMaxAge, 10),
      auditMaxAgeDays: parseInt(options.auditMaxAge, 10),
      dryRun: options.dryRun ?? false
    });
    console.log(formatMaintenanceReport(report));
    db.close();
  });
```

---

## Cron Setup Example

```bash
# Weekly maintenance (Sunday 3am)
0 3 * * 0 npx claude-mem maintenance >> /var/log/claude-mem-maintenance.log 2>&1
```

---

## Tests

```typescript
describe('Maintenance CLI', () => {
  it('should not delete on dry run', async () => {
    // Insert old data
    // Run with dryRun: true
    // Verify data still exists
  });

  it('should delete old records', async () => {
    // Insert old data
    // Run with dryRun: false
    // Verify data deleted
  });
});
```

---

## Commit

```bash
git commit -m "feat: add maintenance CLI for cleanup operations

- claude-mem maintenance [--dry-run]
- Cleans up old aliases and audit logs
- Reports agent health stats
- Configurable age thresholds

Part of #15"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-4.3-metrics-endpoint.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 4.2 -->
## Context from Previous Agent

Task 4.2 is complete. Maintenance CLI is available:

```bash
# Preview cleanup
npx claude-mem maintenance --dry-run

# Actual cleanup
npx claude-mem maintenance

# Custom thresholds
npx claude-mem maintenance --alias-max-age=180 --audit-max-age=30
```

Your task is to add a /api/metrics endpoint for monitoring.
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] Dry run doesn't delete
- [ ] Actual run deletes old records
- [ ] Reports correct counts
- [ ] Agent stats included
- [ ] Handoff comment added
