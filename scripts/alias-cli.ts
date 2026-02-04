#!/usr/bin/env bun
/**
 * Project Alias Management CLI
 *
 * Manage project aliases for the claude-mem migration from folder-based
 * identifiers to git-remote-based identifiers.
 *
 * Usage:
 *   bun scripts/alias-cli.ts list [project]           # List all aliases, optionally filter by project
 *   bun scripts/alias-cli.ts add <old> <new>          # Add a new alias
 *   bun scripts/alias-cli.ts cleanup [--days=365]     # Delete old aliases
 *   bun scripts/alias-cli.ts cleanup --dry-run        # Show what would be deleted
 *   bun scripts/alias-cli.ts count <project>          # Count aliases for a project
 */

import { ClaudeMemDatabase } from '../src/services/sqlite/Database.js';
import {
  listAliases,
  addAlias,
  cleanupAliases,
  countAliases,
  formatAliasList,
} from '../src/cli/commands/alias.js';

function showHelp(): void {
  console.log(`
Claude-Mem Project Alias Management

Manage project aliases for backwards compatibility when migrating from
folder-based identifiers to git-remote-based identifiers.

Usage:
  bun scripts/alias-cli.ts <command> [options]

Commands:
  list [project]        List all aliases, optionally filter by project
  add <old> <new>       Add a new project alias
  cleanup [options]     Delete old aliases
  count <project>       Count aliases for a project

Options:
  --help, -h            Show this help message

Cleanup Options:
  --days <days>         Delete aliases older than N days (default: 365)
  --dry-run             Show what would be deleted without deleting

Examples:
  # List all aliases
  bun scripts/alias-cli.ts list

  # List aliases for a specific project
  bun scripts/alias-cli.ts list github.com/user/repo

  # Add a new alias (maps old folder name to new git remote ID)
  bun scripts/alias-cli.ts add my-project github.com/user/my-project

  # Check how many aliases would be deleted
  bun scripts/alias-cli.ts cleanup --dry-run

  # Delete aliases older than 180 days
  bun scripts/alias-cli.ts cleanup --days 180

  # Count aliases for a project
  bun scripts/alias-cli.ts count github.com/user/repo
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  // Help flag
  if (!command || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  // Open database
  let db: ReturnType<typeof ClaudeMemDatabase.prototype.db>;
  try {
    const memDb = new ClaudeMemDatabase();
    db = memDb.db;
  } catch (error) {
    console.error('Failed to open database:', (error as Error).message);
    process.exit(1);
  }

  try {
    switch (command) {
      case 'list': {
        const project = args[1];
        const result = listAliases(db, project);
        console.log(formatAliasList(result));
        break;
      }

      case 'add': {
        const oldProject = args[1];
        const newProject = args[2];

        if (!oldProject || !newProject) {
          console.error('Usage: bun scripts/alias-cli.ts add <old> <new>');
          console.error('\nBoth old and new project names are required.');
          process.exit(1);
        }

        const result = addAlias(db, oldProject, newProject);
        console.log(result.message);

        if (!result.success) {
          process.exit(1);
        }
        break;
      }

      case 'cleanup': {
        // Parse options
        let days = 365;
        let dryRun = false;

        for (let i = 1; i < args.length; i++) {
          const arg = args[i];
          if (arg === '--dry-run') {
            dryRun = true;
          } else if (arg === '--days' && args[i + 1]) {
            days = parseInt(args[i + 1], 10);
            i++; // Skip next arg
          } else if (arg.startsWith('--days=')) {
            days = parseInt(arg.split('=')[1], 10);
          }
        }

        if (isNaN(days) || days < 1) {
          console.error('Invalid --days value. Must be a positive integer.');
          process.exit(1);
        }

        const result = cleanupAliases(db, { days, dryRun });

        if (dryRun) {
          console.log(`[DRY RUN] Would delete ${result.wouldDelete} alias(es) older than ${days} days.`);
        } else {
          console.log(`Deleted ${result.deleted} alias(es) older than ${days} days.`);
        }
        break;
      }

      case 'count': {
        const project = args[1];

        if (!project) {
          console.error('Usage: bun scripts/alias-cli.ts count <project>');
          console.error('\nProject name is required.');
          process.exit(1);
        }

        const result = countAliases(db, project);

        console.log(`Project: ${result.project}`);
        console.log(`Aliases: ${result.count}`);

        if (result.exceedsLimit) {
          console.warn(`\nWarning: Alias count exceeds query limit of ${result.limit}.`);
          console.warn('Consider running cleanup to reduce alias count.');
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run with --help for usage information.');
        process.exit(1);
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
