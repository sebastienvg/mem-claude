/**
 * Agent Launch Wrapper
 *
 * Safely creates a tmux session and launches Claude Code
 * without using send-keys for large payloads.
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { sessionExists } from './tmux.js';

export interface LaunchOptions {
  sessionName: string;
  cwd: string;
  taskFile: string;          // Path to TASK.md (relative to cwd or absolute)
  skipPermissions?: boolean;  // Default: true
}

export interface LaunchResult {
  success: boolean;
  sessionName: string;
  error?: string;
}

/**
 * Launch a Claude Code agent in a new tmux session.
 *
 * Creates a launcher script in the agent's workspace to avoid
 * tmux send-keys buffer overflow issues with large prompts.
 */
export function launchAgent(options: LaunchOptions): LaunchResult {
  const { sessionName, cwd, taskFile, skipPermissions = true } = options;

  // Validate inputs
  if (sessionExists(sessionName)) {
    return { success: false, sessionName, error: `Session '${sessionName}' already exists` };
  }

  if (!existsSync(cwd)) {
    return { success: false, sessionName, error: `Directory '${cwd}' does not exist` };
  }

  const taskPath = taskFile.startsWith('/') ? taskFile : join(cwd, taskFile);
  if (!existsSync(taskPath)) {
    return { success: false, sessionName, error: `Task file '${taskPath}' not found` };
  }

  // Write launcher script to agent workspace
  const launcherPath = join(cwd, '.agent-run.sh');
  const permFlag = skipPermissions ? ' --dangerously-skip-permissions' : '';
  const script = [
    '#!/bin/bash',
    `cd "${cwd}"`,
    `claude${permFlag} -p "$(cat "${taskPath}")"`,
  ].join('\n');

  writeFileSync(launcherPath, script, { mode: 0o755 });

  // Create tmux session and run the launcher
  try {
    execSync(
      `tmux new-session -d -s "${sessionName}" -c "${cwd}" "${launcherPath}"`,
      { timeout: 10000 }
    );
    return { success: true, sessionName };
  } catch (err) {
    return {
      success: false,
      sessionName,
      error: `Failed to create tmux session: ${(err as Error).message}`
    };
  }
}
