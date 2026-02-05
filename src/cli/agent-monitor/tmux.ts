/**
 * Tmux interaction utilities for agent monitoring.
 */

import { execSync } from 'child_process';

/**
 * Build the tmux command to capture a pane's visible content.
 * Uses -S -50 to grab last 50 lines of scrollback.
 */
export function buildCaptureCommand(sessionName: string): string {
  return `tmux capture-pane -t ${sessionName} -p -S -50`;
}

/**
 * Capture the current content of a tmux pane.
 * Returns null if the session doesn't exist.
 */
export function capturePaneContent(sessionName: string): string | null {
  try {
    const cmd = buildCaptureCommand(sessionName);
    return execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trimEnd();
  } catch {
    return null;
  }
}

/**
 * Parse `tmux list-sessions` output into session names.
 */
export function parseSessionList(output: string): string[] {
  if (!output.trim()) return [];
  return output
    .trim()
    .split('\n')
    .map(line => line.split(':')[0].trim())
    .filter(Boolean);
}

/**
 * List all tmux sessions.
 */
export function listAllSessions(): string[] {
  try {
    const output = execSync('tmux list-sessions', { encoding: 'utf-8', timeout: 5000 });
    return parseSessionList(output);
  } catch {
    return [];
  }
}

/**
 * List sessions matching a prefix or pattern.
 */
export function listMonitoredSessions(prefix?: string): string[] {
  const all = listAllSessions();
  if (!prefix) return all;
  return all.filter(s => s.startsWith(prefix));
}

/**
 * Check if a tmux session exists.
 */
export function sessionExists(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t ${sessionName}`, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
