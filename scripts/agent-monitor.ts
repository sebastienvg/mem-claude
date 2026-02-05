#!/usr/bin/env bun
/**
 * Agent Monitor CLI
 *
 * Monitor and manage Claude Code agents running in tmux sessions.
 *
 * Usage:
 *   bun scripts/agent-monitor.ts status <session>     # Check agent state
 *   bun scripts/agent-monitor.ts status --all         # Check all sessions
 *   bun scripts/agent-monitor.ts wait <session>       # Block until agent is ready
 *   bun scripts/agent-monitor.ts launch <session> --cwd <dir> --task <file>
 */

import { detectAgentState, AgentState } from '../src/cli/agent-monitor/state-detector.js';
import { capturePaneContent, listAllSessions, sessionExists } from '../src/cli/agent-monitor/tmux.js';
import { pollUntilReady } from '../src/cli/agent-monitor/wait.js';
import { launchAgent } from '../src/cli/agent-monitor/launch.js';

function showHelp(): void {
  console.log(`
Agent Monitor — tmux agent session manager

Usage:
  bun scripts/agent-monitor.ts <command> [options]

Commands:
  status <session>        Show agent state (done/waiting/busy/unknown)
  status --all            Show all tmux session states
  wait <session>          Block until agent is done or waiting
  launch <name>           Launch a Claude agent in a new tmux session
    --cwd <dir>           Working directory (required)
    --task <file>         Task file path, relative to cwd (default: TASK.md)

Options:
  --timeout <ms>          Timeout for wait command (default: 600000 = 10min)
  --poll <ms>             Poll interval for wait command (default: 5000 = 5s)
  --help, -h              Show this help
`);
}

function getAgentState(sessionName: string): AgentState {
  const pane = capturePaneContent(sessionName);
  if (pane === null) return AgentState.UNKNOWN;
  return detectAgentState(pane);
}

async function cmdStatus(sessionName: string | null, all: boolean): Promise<void> {
  if (all) {
    const sessions = listAllSessions();
    if (sessions.length === 0) {
      console.log('No tmux sessions found.');
      return;
    }
    const maxLen = Math.max(7, ...sessions.map(s => s.length)) + 2;
    console.log('SESSION'.padEnd(maxLen) + 'STATE');
    console.log('-'.repeat(maxLen + 10));
    for (const s of sessions) {
      const state = getAgentState(s);
      console.log(s.padEnd(maxLen) + state);
    }
    return;
  }

  if (!sessionName) {
    console.error('Usage: agent-monitor status <session> | --all');
    process.exit(1);
  }

  if (!sessionExists(sessionName)) {
    console.error(`Session '${sessionName}' not found.`);
    process.exit(1);
  }

  const state = getAgentState(sessionName);
  console.log(JSON.stringify({ session: sessionName, state }));
}

async function cmdWait(sessionName: string, timeoutMs: number, pollMs: number): Promise<void> {
  if (!sessionExists(sessionName)) {
    console.error(`Session '${sessionName}' not found.`);
    process.exit(1);
  }

  console.error(`Waiting for '${sessionName}'...`);
  const result = await pollUntilReady(
    () => getAgentState(sessionName),
    { pollIntervalMs: pollMs, timeoutMs }
  );

  if (result.timedOut) {
    console.error(`Timed out after ${result.elapsedMs}ms. Last state: ${result.state}`);
    process.exit(2);
  }

  console.log(JSON.stringify({
    session: sessionName,
    state: result.state,
    elapsedMs: result.elapsedMs
  }));
}

function cmdLaunch(sessionName: string, cwd: string, taskFile: string): void {
  const result = launchAgent({ sessionName, cwd, taskFile });
  if (!result.success) {
    console.error(`Launch failed: ${result.error}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ session: sessionName, launched: true }));
}

// Parse args
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  showHelp();
  process.exit(0);
}

const command = args[0];

switch (command) {
  case 'status': {
    const all = args.includes('--all');
    const session = all ? null : args[1];
    await cmdStatus(session, all);
    break;
  }
  case 'wait': {
    const session = args[1];
    if (!session) { console.error('Usage: agent-monitor wait <session>'); process.exit(1); }
    const timeoutIdx = args.indexOf('--timeout');
    const pollIdx = args.indexOf('--poll');
    const timeout = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1]) : 600000;
    const poll = pollIdx !== -1 ? parseInt(args[pollIdx + 1]) : 5000;
    await cmdWait(session, timeout, poll);
    break;
  }
  case 'launch': {
    const session = args[1];
    if (!session) { console.error('Usage: agent-monitor launch <name> --cwd <dir>'); process.exit(1); }
    const cwdIdx = args.indexOf('--cwd');
    const taskIdx = args.indexOf('--task');
    if (cwdIdx === -1) { console.error('--cwd is required'); process.exit(1); }
    const cwd = args[cwdIdx + 1];
    const task = taskIdx !== -1 ? args[taskIdx + 1] : 'TASK.md';
    cmdLaunch(session, cwd, task);
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}
