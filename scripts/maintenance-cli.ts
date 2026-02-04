#!/usr/bin/env bun
/**
 * Claude-Mem Maintenance CLI (Task 4.2)
 *
 * Run periodic maintenance tasks: cleanup old aliases, prune audit logs,
 * and show system health statistics.
 *
 * Usage:
 *   bun scripts/maintenance-cli.ts                          # Run with default thresholds
 *   bun scripts/maintenance-cli.ts --dry-run                # Preview without deleting
 *   bun scripts/maintenance-cli.ts --alias-max-age=180      # Custom alias threshold
 *   bun scripts/maintenance-cli.ts --audit-max-age=30       # Custom audit threshold
 *
 * Cron example (weekly maintenance on Sunday at 3am):
 *   0 3 * * 0 npx claude-mem maintenance >> /var/log/claude-mem-maintenance.log 2>&1
 */

import { ClaudeMemDatabase } from '../src/services/sqlite/Database.js';
import {
  runMaintenance,
  formatMaintenanceReport,
  type MaintenanceOptions,
} from '../src/cli/commands/maintenance.js';

function showHelp(): void {
  console.log(`
Claude-Mem Maintenance

Run periodic maintenance tasks to clean up old data and show system health.

Usage:
  bun scripts/maintenance-cli.ts [options]

Options:
  --alias-max-age <days>    Max age for aliases in days (default: 365)
  --audit-max-age <days>    Max age for audit logs in days (default: 90)
  --dry-run                 Preview without deleting
  --help, -h                Show this help message

Examples:
  # Preview cleanup with default thresholds
  bun scripts/maintenance-cli.ts --dry-run

  # Perform cleanup with default thresholds
  bun scripts/maintenance-cli.ts

  # Custom thresholds: 180 days for aliases, 30 days for audit logs
  bun scripts/maintenance-cli.ts --alias-max-age=180 --audit-max-age=30

  # Aggressive cleanup for testing
  bun scripts/maintenance-cli.ts --alias-max-age=7 --audit-max-age=7 --dry-run

Cron Setup:
  # Weekly maintenance (Sunday 3am)
  0 3 * * 0 cd /path/to/claude-mem && bun scripts/maintenance-cli.ts >> /var/log/claude-mem-maintenance.log 2>&1
`);
}

function parseArgs(args: string[]): MaintenanceOptions & { help: boolean } {
  let aliasMaxAgeDays = 365;
  let auditMaxAgeDays = 90;
  let dryRun = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--alias-max-age' && args[i + 1]) {
      aliasMaxAgeDays = parseInt(args[i + 1], 10);
      i++; // Skip next arg
    } else if (arg.startsWith('--alias-max-age=')) {
      aliasMaxAgeDays = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--audit-max-age' && args[i + 1]) {
      auditMaxAgeDays = parseInt(args[i + 1], 10);
      i++; // Skip next arg
    } else if (arg.startsWith('--audit-max-age=')) {
      auditMaxAgeDays = parseInt(arg.split('=')[1], 10);
    }
  }

  return { aliasMaxAgeDays, auditMaxAgeDays, dryRun, help };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Help flag
  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Validate options
  if (isNaN(options.aliasMaxAgeDays) || options.aliasMaxAgeDays < 1) {
    console.error('Invalid --alias-max-age value. Must be a positive integer.');
    process.exit(1);
  }

  if (isNaN(options.auditMaxAgeDays) || options.auditMaxAgeDays < 1) {
    console.error('Invalid --audit-max-age value. Must be a positive integer.');
    process.exit(1);
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
    // Show configuration
    if (options.dryRun) {
      console.log('Running maintenance in dry-run mode...');
    } else {
      console.log('Running maintenance...');
    }
    console.log(`  Alias threshold: ${options.aliasMaxAgeDays} days`);
    console.log(`  Audit threshold: ${options.auditMaxAgeDays} days`);
    console.log('');

    // Run maintenance
    const report = await runMaintenance(db, {
      aliasMaxAgeDays: options.aliasMaxAgeDays,
      auditMaxAgeDays: options.auditMaxAgeDays,
      dryRun: options.dryRun,
    });

    // Display report
    console.log(formatMaintenanceReport(report));
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
