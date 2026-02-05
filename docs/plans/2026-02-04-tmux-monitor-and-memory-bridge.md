# Tmux Agent Monitor & Auto Memory Bridge

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build orchestrator tooling for reliable tmux agent management (#31) and integrate Claude Code's undocumented auto memory with claude-mem (#32).

**Architecture:** Two independent feature tracks. Track A builds a Bun CLI (`scripts/agent-monitor.ts`) that captures tmux panes, classifies agent state, and provides `agent-wait`/`agent-launch` commands. Track B extends the SessionStart hook to write a curated briefing into Claude Code's `~/.claude/projects/<path>/memory/MEMORY.md`, turning claude-mem into the source of truth for both memory systems.

**Tech Stack:** TypeScript (Bun runtime), tmux CLI, Express HTTP API, existing claude-mem hook infrastructure.

**Related Issues:**
- https://github.com/sebastienvg/mem-claude/issues/31 (Tmux agent monitor)
- https://github.com/sebastienvg/mem-claude/issues/32 (Auto memory cohabitation)

---

## Track A: Tmux Agent Monitor (#31)

### Agent Assignment: `monitor`
**Parallel with:** Track B research (Tasks 7-8)
**Branch:** `feat/tmux-agent-monitor`

---

### Task 1: Create agent state detection module

**Files:**
- Create: `src/cli/agent-monitor/state-detector.ts`
- Create: `tests/agent-monitor/state-detector.test.ts`

The state detector takes raw tmux pane text and classifies agent state.

**Step 1: Write the failing test**

Create test file `tests/agent-monitor/state-detector.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { detectAgentState, AgentState } from '../../src/cli/agent-monitor/state-detector.js';

describe('detectAgentState', () => {
  it('should detect shell prompt as "done"', () => {
    const pane = 'seb@Mac project % ';
    expect(detectAgentState(pane)).toBe(AgentState.DONE);
  });

  it('should detect bash prompt as "done"', () => {
    const pane = 'user@host:~/project$ ';
    expect(detectAgentState(pane)).toBe(AgentState.DONE);
  });

  it('should detect Claude Code insert mode as "waiting"', () => {
    const pane = '❯ \n  -- INSERT -- ⏵⏵ bypass permissions on';
    expect(detectAgentState(pane)).toBe(AgentState.WAITING);
  });

  it('should detect Claude Code spinner as "busy"', () => {
    const pane = '⠙ Thinking...';
    expect(detectAgentState(pane)).toBe(AgentState.BUSY);
  });

  it('should detect Crystallizing as "busy"', () => {
    const pane = '✶ Crystallizing… (thinking)';
    expect(detectAgentState(pane)).toBe(AgentState.BUSY);
  });

  it('should detect Crunched as "busy"', () => {
    const pane = '✻ Crunched for 42s';
    expect(detectAgentState(pane)).toBe(AgentState.BUSY);
  });

  it('should return "unknown" for unrecognized output', () => {
    const pane = 'random output without recognizable patterns';
    expect(detectAgentState(pane)).toBe(AgentState.UNKNOWN);
  });

  it('should only look at the last few lines of the pane', () => {
    const pane = [
      '  -- INSERT -- ⏵⏵ bypass permissions on',  // old: was waiting
      'lots of output here',
      'more output',
      'seb@Mac project % '  // current: done
    ].join('\n');
    expect(detectAgentState(pane)).toBe(AgentState.DONE);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/agent-monitor/state-detector.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement the state detector**

Create `src/cli/agent-monitor/state-detector.ts`:

```typescript
/**
 * Tmux Agent State Detector
 *
 * Classifies agent state from tmux pane capture text.
 * Looks at the last N lines to determine current state.
 */

export enum AgentState {
  DONE = 'done',         // Back at shell prompt (agent process exited)
  WAITING = 'waiting',   // At Claude Code ❯ prompt, awaiting input
  BUSY = 'busy',         // Claude Code is processing (spinner, thinking)
  UNKNOWN = 'unknown',   // Can't determine state
}

// How many trailing lines to analyze (avoids false positives from old output)
const TAIL_LINES = 5;

// Shell prompt patterns (zsh %, bash $)
const SHELL_PROMPT_RE = /[%$]\s*$/;

// Claude Code waiting for input
const CLAUDE_INSERT_RE = /--\s*INSERT\s*--/;

// Claude Code busy indicators
const CLAUDE_BUSY_PATTERNS = [
  /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/,    // Braille spinner characters
  /Thinking/,
  /Crystallizing/,
  /Crunched/,
  /Working/,
];

/**
 * Detect agent state from raw tmux pane text.
 *
 * Priority (checked against last TAIL_LINES):
 * 1. Shell prompt at end → DONE
 * 2. Claude INSERT mode → WAITING
 * 3. Spinner/thinking indicators → BUSY
 * 4. Otherwise → UNKNOWN
 */
export function detectAgentState(paneText: string): AgentState {
  const lines = paneText.split('\n');
  const tail = lines.slice(-TAIL_LINES).join('\n');

  // Check last line specifically for shell prompt
  const lastLine = lines[lines.length - 1] || '';
  if (SHELL_PROMPT_RE.test(lastLine)) {
    return AgentState.DONE;
  }

  // Check tail for Claude Code patterns
  if (CLAUDE_INSERT_RE.test(tail)) {
    return AgentState.WAITING;
  }

  for (const pattern of CLAUDE_BUSY_PATTERNS) {
    if (pattern.test(tail)) {
      return AgentState.BUSY;
    }
  }

  return AgentState.UNKNOWN;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/agent-monitor/state-detector.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/agent-monitor/state-detector.ts tests/agent-monitor/state-detector.test.ts
git commit -m "feat: add tmux agent state detection module (#31)"
```

---

### Task 2: Create tmux pane capture utility

**Files:**
- Create: `src/cli/agent-monitor/tmux.ts`
- Create: `tests/agent-monitor/tmux.test.ts`

**Step 1: Write the failing test**

Create `tests/agent-monitor/tmux.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { listMonitoredSessions, buildCaptureCommand, parseSessionList } from '../../src/cli/agent-monitor/tmux.js';

describe('buildCaptureCommand', () => {
  it('should build tmux capture-pane command', () => {
    const cmd = buildCaptureCommand('my-agent');
    expect(cmd).toContain('capture-pane');
    expect(cmd).toContain('-t');
    expect(cmd).toContain('my-agent');
    expect(cmd).toContain('-p');  // print mode
    expect(cmd).toContain('-S');  // scroll back
  });
});

describe('parseSessionList', () => {
  it('should parse tmux list-sessions output', () => {
    const output = [
      'verbosity: 1 windows (created Wed Feb  4 17:43:13 2026)',
      'recency: 1 windows (created Wed Feb  4 17:43:15 2026)',
      'docker-sync: 1 windows (created Wed Feb  4 17:43:15 2026)',
    ].join('\n');

    const sessions = parseSessionList(output);
    expect(sessions).toEqual(['verbosity', 'recency', 'docker-sync']);
  });

  it('should return empty array for empty input', () => {
    expect(parseSessionList('')).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/agent-monitor/tmux.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement tmux utilities**

Create `src/cli/agent-monitor/tmux.ts`:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/agent-monitor/tmux.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/agent-monitor/tmux.ts tests/agent-monitor/tmux.test.ts
git commit -m "feat: add tmux pane capture utilities (#31)"
```

---

### Task 3: Create agent-wait polling function

**Files:**
- Create: `src/cli/agent-monitor/wait.ts`
- Create: `tests/agent-monitor/wait.test.ts`

**Step 1: Write the failing test**

Create `tests/agent-monitor/wait.test.ts`:

```typescript
import { describe, it, expect, mock } from 'bun:test';
import { AgentState } from '../../src/cli/agent-monitor/state-detector.js';

// We'll test the logic, not the actual tmux interaction
describe('waitForAgent logic', () => {
  it('should resolve immediately if agent is already done', async () => {
    // Import after mocking
    const { pollUntilReady } = await import('../../src/cli/agent-monitor/wait.js');
    const result = await pollUntilReady(
      () => AgentState.DONE,  // state provider
      { pollIntervalMs: 10, timeoutMs: 1000 }
    );
    expect(result.state).toBe(AgentState.DONE);
    expect(result.timedOut).toBe(false);
  });

  it('should resolve when agent transitions to waiting', async () => {
    const { pollUntilReady } = await import('../../src/cli/agent-monitor/wait.js');
    let callCount = 0;
    const result = await pollUntilReady(
      () => ++callCount < 3 ? AgentState.BUSY : AgentState.WAITING,
      { pollIntervalMs: 10, timeoutMs: 5000 }
    );
    expect(result.state).toBe(AgentState.WAITING);
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it('should timeout if agent stays busy', async () => {
    const { pollUntilReady } = await import('../../src/cli/agent-monitor/wait.js');
    const result = await pollUntilReady(
      () => AgentState.BUSY,
      { pollIntervalMs: 10, timeoutMs: 50 }
    );
    expect(result.timedOut).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/agent-monitor/wait.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement wait/poll logic**

Create `src/cli/agent-monitor/wait.ts`:

```typescript
/**
 * Agent wait/polling logic.
 * Polls a state provider until agent is done or waiting.
 */

import { AgentState } from './state-detector.js';

export interface PollOptions {
  pollIntervalMs: number;
  timeoutMs: number;
}

export interface PollResult {
  state: AgentState;
  timedOut: boolean;
  elapsedMs: number;
}

const READY_STATES = new Set([AgentState.DONE, AgentState.WAITING]);

/**
 * Poll a state provider until the agent reaches a ready state.
 *
 * @param getState - Function that returns the current agent state
 * @param options - Polling interval and timeout
 * @returns The final state and whether it timed out
 */
export async function pollUntilReady(
  getState: () => AgentState,
  options: PollOptions
): Promise<PollResult> {
  const start = Date.now();

  while (true) {
    const state = getState();

    if (READY_STATES.has(state)) {
      return { state, timedOut: false, elapsedMs: Date.now() - start };
    }

    const elapsed = Date.now() - start;
    if (elapsed >= options.timeoutMs) {
      return { state, timedOut: true, elapsedMs: elapsed };
    }

    await new Promise(resolve => setTimeout(resolve, options.pollIntervalMs));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/agent-monitor/wait.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/agent-monitor/wait.ts tests/agent-monitor/wait.test.ts
git commit -m "feat: add agent-wait polling logic (#31)"
```

---

### Task 4: Create agent-launch wrapper

**Files:**
- Create: `src/cli/agent-monitor/launch.ts`

This is the safe launcher that avoids the `send-keys` buffer overflow problem.

**Step 1: Implement the launcher**

Create `src/cli/agent-monitor/launch.ts`:

```typescript
/**
 * Agent Launch Wrapper
 *
 * Safely creates a tmux session and launches Claude Code
 * without using send-keys for large payloads.
 */

import { execSync, spawn } from 'child_process';
import { writeFileSync, chmodSync, existsSync } from 'fs';
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
```

**Step 2: Commit**

```bash
git add src/cli/agent-monitor/launch.ts
git commit -m "feat: add agent-launch wrapper for safe tmux spawning (#31)"
```

---

### Task 5: Create the CLI entry point

**Files:**
- Create: `scripts/agent-monitor.ts`

Follows the pattern in `scripts/maintenance-cli.ts`.

**Step 1: Implement the CLI**

Create `scripts/agent-monitor.ts`:

```typescript
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
    console.log('SESSION'.padEnd(30) + 'STATE');
    console.log('-'.repeat(40));
    for (const s of sessions) {
      const state = getAgentState(s);
      console.log(s.padEnd(30) + state);
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
```

**Step 2: Add npm script to package.json**

Add to `scripts` in `package.json`:
```json
"agent:monitor": "bun scripts/agent-monitor.ts"
```

**Step 3: Commit**

```bash
git add scripts/agent-monitor.ts package.json
git commit -m "feat: add agent-monitor CLI for tmux orchestration (#31)"
```

---

### Task 6: Integration test with real tmux

**Step 1: Manual integration test**

```bash
# Create a test session
tmux new-session -d -s test-agent -c /tmp
tmux send-keys -t test-agent 'echo "hello world"' Enter

# Test status
bun scripts/agent-monitor.ts status test-agent
# Expected: {"session":"test-agent","state":"done"}

# Test --all
bun scripts/agent-monitor.ts status --all
# Expected: table with test-agent showing "done"

# Test wait (should return immediately since agent is done)
bun scripts/agent-monitor.ts wait test-agent --timeout 5000
# Expected: {"session":"test-agent","state":"done","elapsedMs":...}

# Cleanup
tmux kill-session -t test-agent
```

**Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration test findings for agent-monitor (#31)"
```

---

## Track B: Auto Memory Bridge (#32)

### Phase 1: Research (parallel with Track A)

### Agent Assignment: `memory-research`
**Parallel with:** Track A (Tasks 1-6)
**Branch:** `feat/auto-memory-bridge`

---

### Task 7: Investigate auto memory path encoding

**Goal:** Document exactly how Claude Code encodes project paths into the `~/.claude/projects/<encoded>/memory/` directory. This is essential before writing code that targets that path.

**Step 1: Examine existing auto memory directories**

```bash
# List all project memory directories
ls -la ~/.claude/projects/

# Check which ones have memory/ subdirs
find ~/.claude/projects/ -name "memory" -type d

# Check the encoding pattern
# Known: /Users/seb/AI/mem-claude → -Users-seb-AI-mem-claude
# Verify: are forward slashes replaced with dashes? What about the leading slash?
```

**Step 2: Test with a known path**

```bash
# Create a temporary project dir
mkdir -p /tmp/test-memory-project
cd /tmp/test-memory-project
git init

# Start a Claude Code session briefly and check what directory was created
claude --dangerously-skip-permissions -p "Write 'test' to /dev/null"

# Check what was created
ls ~/.claude/projects/ | grep test-memory
# Expected: -tmp-test-memory-project or similar

# Clean up
rm -rf /tmp/test-memory-project
```

**Step 3: Document the encoding function**

Write findings to `docs/research/auto-memory-path-encoding.md`:
- Exact encoding rules (slash → dash, leading dash, etc.)
- Whether CWD or git root is used as the base path
- Whether worktrees get separate memory directories
- Whether agentspaces subdirectories get their own directories

**Step 4: Commit**

```bash
git add docs/research/auto-memory-path-encoding.md
git commit -m "research: document auto memory path encoding (#32)"
```

---

### Task 8: Test MEMORY.md behavior

**Goal:** Understand how Claude Code interacts with MEMORY.md when it already has content.

**Step 1: Pre-populate MEMORY.md**

```bash
# Find the auto memory dir for this project
MEMORY_DIR="$HOME/.claude/projects/-Users-seb-AI-mem-claude/memory"
mkdir -p "$MEMORY_DIR"

# Write tagged content (like claude-mem would)
cat > "$MEMORY_DIR/MEMORY.md" << 'EOF'
<claude-mem-briefing>
# Project Briefing (auto-generated by claude-mem)

## Recent Focus
- Observation quality controls feature
- Tmux agent orchestration

## Key Patterns
- TDD with Bun test runner
- Atomic file writes with temp + rename
</claude-mem-briefing>
EOF
```

**Step 2: Start a Claude Code session and observe**

```bash
cd /Users/seb/AI/mem-claude
claude --dangerously-skip-permissions -p "What does your MEMORY.md say? Quote it exactly. Do NOT modify it."
```

Check:
- Does Claude see the content in its system prompt?
- Does it respect the `<claude-mem-briefing>` tags?
- Does it try to overwrite or append to the file?

**Step 3: Test if Claude modifies pre-existing content**

```bash
# Start a session that triggers a "lesson learned"
claude --dangerously-skip-permissions -p "I just learned that bun test runs faster with --bail. Remember this in your MEMORY.md."

# Check what happened
cat "$MEMORY_DIR/MEMORY.md"
```

Check:
- Did Claude preserve the `<claude-mem-briefing>` tags?
- Did it add its own content outside the tags?
- Did it overwrite everything?

**Step 4: Document findings**

Add findings to `docs/research/auto-memory-behavior.md`:
- How Claude treats pre-existing MEMORY.md content
- Whether tagged sections are preserved
- Whether Claude writes freely or respects structure
- What instructions in MEMORY.md itself can influence behavior

**Step 5: Commit**

```bash
git add docs/research/auto-memory-behavior.md
git commit -m "research: document auto memory MEMORY.md behavior (#32)"
```

---

### Phase 2: Implementation (after research)

### Agent Assignment: `memory-bridge`
**Depends on:** Tasks 7-8 (research findings)
**Branch:** `feat/auto-memory-bridge` (same branch)

---

### Task 9: Add auto memory path resolver

**Files:**
- Create: `src/utils/auto-memory-path.ts`
- Create: `tests/utils/auto-memory-path.test.ts`

**Step 1: Write the failing test**

Create `tests/utils/auto-memory-path.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { getAutoMemoryDir, getAutoMemoryFilePath, encodeProjectPath } from '../../src/utils/auto-memory-path.js';
import { join } from 'path';
import { homedir } from 'os';

describe('encodeProjectPath', () => {
  it('should replace path separators with dashes', () => {
    expect(encodeProjectPath('/Users/seb/AI/mem-claude')).toBe('-Users-seb-AI-mem-claude');
  });

  it('should handle paths without leading slash', () => {
    expect(encodeProjectPath('Users/seb/project')).toBe('Users-seb-project');
  });
});

describe('getAutoMemoryDir', () => {
  it('should return the correct memory directory path', () => {
    const dir = getAutoMemoryDir('/Users/seb/AI/mem-claude');
    expect(dir).toBe(join(homedir(), '.claude', 'projects', '-Users-seb-AI-mem-claude', 'memory'));
  });
});

describe('getAutoMemoryFilePath', () => {
  it('should return path to MEMORY.md', () => {
    const p = getAutoMemoryFilePath('/Users/seb/AI/mem-claude');
    expect(p).toBe(join(homedir(), '.claude', 'projects', '-Users-seb-AI-mem-claude', 'memory', 'MEMORY.md'));
  });
});
```

NOTE: Adjust the encoding logic based on findings from Task 7. The test above assumes slashes become dashes and the leading slash becomes a leading dash.

**Step 2: Run test to verify it fails**

Run: `bun test tests/utils/auto-memory-path.test.ts`
Expected: FAIL

**Step 3: Implement the path resolver**

Create `src/utils/auto-memory-path.ts`:

```typescript
/**
 * Auto Memory Path Resolver
 *
 * Resolves paths to Claude Code's undocumented auto memory directory.
 * Located at: ~/.claude/projects/<encoded-path>/memory/MEMORY.md
 *
 * Path encoding: forward slashes replaced with dashes.
 * Example: /Users/seb/AI/mem-claude → -Users-seb-AI-mem-claude
 */

import { join } from 'path';
import { homedir } from 'os';

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

/**
 * Encode an absolute project path into Claude Code's directory-name format.
 * Replaces all path separators with dashes.
 */
export function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(/\//g, '-');
}

/**
 * Get the auto memory directory for a project.
 */
export function getAutoMemoryDir(projectPath: string): string {
  const encoded = encodeProjectPath(projectPath);
  return join(CLAUDE_DIR, 'projects', encoded, 'memory');
}

/**
 * Get the full path to MEMORY.md for a project.
 */
export function getAutoMemoryFilePath(projectPath: string): string {
  return join(getAutoMemoryDir(projectPath), 'MEMORY.md');
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/utils/auto-memory-path.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/auto-memory-path.ts tests/utils/auto-memory-path.test.ts
git commit -m "feat: add auto memory path resolver (#32)"
```

---

### Task 10: Add MEMORY.md briefing writer

**Files:**
- Create: `src/utils/memory-briefing.ts`
- Create: `tests/utils/memory-briefing.test.ts`

Uses the same `replaceTaggedContent()` pattern from `claude-md-utils.ts` but with `<claude-mem-briefing>` tags.

**Step 1: Write the failing test**

Create `tests/utils/memory-briefing.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { buildBriefingContent, writeMemoryBriefing, BRIEFING_START_TAG, BRIEFING_END_TAG } from '../../src/utils/memory-briefing.js';

describe('buildBriefingContent', () => {
  it('should include project name in header', () => {
    const content = buildBriefingContent('github.com/user/repo', []);
    expect(content).toContain('github.com/user/repo');
  });

  it('should include observation summaries', () => {
    const observations = [
      { title: 'Added auth system', type: 'discovery', time: '3:00 PM' },
      { title: 'Fixed login bug', type: 'discovery', time: '4:00 PM' },
    ];
    const content = buildBriefingContent('test-project', observations);
    expect(content).toContain('Added auth system');
    expect(content).toContain('Fixed login bug');
  });

  it('should respect 200-line limit', () => {
    const manyObs = Array.from({ length: 100 }, (_, i) => ({
      title: `Observation ${i}`,
      type: 'discovery',
      time: '1:00 PM',
    }));
    const content = buildBriefingContent('test', manyObs);
    const lines = content.split('\n');
    expect(lines.length).toBeLessThanOrEqual(190); // Leave headroom below 200
  });
});

describe('tag constants', () => {
  it('should use claude-mem-briefing tags', () => {
    expect(BRIEFING_START_TAG).toBe('<claude-mem-briefing>');
    expect(BRIEFING_END_TAG).toBe('</claude-mem-briefing>');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/utils/memory-briefing.test.ts`
Expected: FAIL

**Step 3: Implement briefing builder**

Create `src/utils/memory-briefing.ts`:

```typescript
/**
 * Memory Briefing Writer
 *
 * Generates a curated MEMORY.md briefing from claude-mem observations.
 * Uses tagged sections to coexist with Claude Code's own auto memory writes.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { replaceTaggedContent } from './claude-md-utils.js';

export const BRIEFING_START_TAG = '<claude-mem-briefing>';
export const BRIEFING_END_TAG = '</claude-mem-briefing>';

// Leave headroom below the 200-line system prompt truncation limit
const MAX_LINES = 180;

interface ObservationSummary {
  title: string;
  type: string;
  time: string;
}

/**
 * Build briefing markdown from recent observations.
 * Kept concise to fit within the 200-line auto memory limit.
 */
export function buildBriefingContent(
  projectName: string,
  observations: ObservationSummary[]
): string {
  const lines: string[] = [];
  lines.push(`# ${projectName} — Briefing`);
  lines.push('');
  lines.push('*Auto-generated by claude-mem. Use MCP search for full history.*');
  lines.push('');

  if (observations.length === 0) {
    lines.push('No recent observations.');
    return lines.join('\n');
  }

  lines.push('## Recent Activity');
  lines.push('');

  for (const obs of observations) {
    const line = `- **${obs.time}** ${obs.title}`;
    lines.push(line);
    if (lines.length >= MAX_LINES - 5) {
      lines.push(`- ... and ${observations.length - lines.length + 7} more (use MCP search)`);
      break;
    }
  }

  return lines.join('\n');
}

/**
 * Replace only the claude-mem-briefing section in existing content.
 * Preserves any content Claude Code or the user wrote outside the tags.
 */
function replaceMemoryBriefingSection(existing: string, newContent: string): string {
  const startIdx = existing.indexOf(BRIEFING_START_TAG);
  const endIdx = existing.indexOf(BRIEFING_END_TAG);

  if (startIdx !== -1 && endIdx !== -1) {
    return existing.substring(0, startIdx) +
      `${BRIEFING_START_TAG}\n${newContent}\n${BRIEFING_END_TAG}` +
      existing.substring(endIdx + BRIEFING_END_TAG.length);
  }

  // No existing tags — prepend (so claude-mem content appears first in system prompt)
  return `${BRIEFING_START_TAG}\n${newContent}\n${BRIEFING_END_TAG}\n\n${existing}`;
}

/**
 * Write briefing content to a MEMORY.md file.
 * Creates the directory if it doesn't exist.
 * Preserves content outside <claude-mem-briefing> tags.
 */
export function writeMemoryBriefing(memoryPath: string, briefingContent: string): void {
  const dir = dirname(memoryPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let existing = '';
  if (existsSync(memoryPath)) {
    existing = readFileSync(memoryPath, 'utf-8');
  }

  const final = replaceMemoryBriefingSection(existing, briefingContent);
  writeFileSync(memoryPath, final);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/utils/memory-briefing.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/memory-briefing.ts tests/utils/memory-briefing.test.ts
git commit -m "feat: add MEMORY.md briefing writer with tag preservation (#32)"
```

---

### Task 11: Wire briefing into SessionStart hook

**Files:**
- Modify: `src/cli/handlers/context.ts`
- Modify: `src/services/worker/http/routes/SearchRoutes.ts` (add briefing endpoint)

**Step 1: Add briefing API endpoint**

Read `src/services/worker/http/routes/SearchRoutes.ts`. Add a new endpoint that returns observation summaries formatted for MEMORY.md briefing. The endpoint should query recent observations and return them in a compact format.

Add after the existing `/api/context/inject` handler:

```typescript
// GET /api/memory/briefing?project=...
router.get('/api/memory/briefing', async (req, res) => {
  const project = req.query.project as string;
  if (!project) {
    return res.status(400).json({ error: 'project parameter required' });
  }

  // Query recent observations (compact: just title, type, time)
  const observations = db.prepare(`
    SELECT title, obs_type as type, created_at
    FROM observations
    WHERE project = ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(project) as Array<{ title: string; type: string; created_at: string }>;

  const summaries = observations.map(o => ({
    title: o.title,
    type: o.type,
    time: new Date(o.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  }));

  res.json({ project, observations: summaries });
});
```

**Step 2: Extend SessionStart to write MEMORY.md**

In `src/cli/handlers/context.ts`, after fetching the context, also fetch the briefing and write to MEMORY.md:

```typescript
import { getAutoMemoryFilePath } from '../../utils/auto-memory-path.js';
import { buildBriefingContent, writeMemoryBriefing } from '../../utils/memory-briefing.js';

// After the existing context fetch, add:
try {
  const briefingUrl = `${baseUrl}/api/memory/briefing?project=${encodeURIComponent(context.primary)}`;
  const briefingResponse = await fetch(briefingUrl);
  if (briefingResponse.ok) {
    const briefingData = await briefingResponse.json();
    const briefing = buildBriefingContent(context.primary, briefingData.observations);
    const memoryPath = getAutoMemoryFilePath(cwd);
    writeMemoryBriefing(memoryPath, briefing);
  }
} catch {
  // Fire-and-forget: don't fail SessionStart over memory briefing
}
```

**Step 3: Run full test suite**

Run: `bun test`
Expected: No regressions.

**Step 4: Commit**

```bash
git add src/cli/handlers/context.ts src/services/worker/http/routes/SearchRoutes.ts
git commit -m "feat: write MEMORY.md briefing on SessionStart (#32)"
```

---

### Task 12: Add CLAUDE_MEM_AUTO_MEMORY setting

**Files:**
- Modify: `src/shared/SettingsDefaultsManager.ts`

Allow users to disable or control the auto memory bridge.

**Step 1: Add setting**

In `src/shared/SettingsDefaultsManager.ts`:
- Add to interface: `CLAUDE_MEM_AUTO_MEMORY: string;  // 'enabled' | 'disabled'`
- Add to DEFAULTS: `CLAUDE_MEM_AUTO_MEMORY: 'enabled',`

**Step 2: Gate the SessionStart write**

In `src/cli/handlers/context.ts`, wrap the MEMORY.md write in a settings check:

```typescript
const autoMemory = SettingsDefaultsManager.get('CLAUDE_MEM_AUTO_MEMORY');
if (autoMemory !== 'disabled') {
  // ... existing briefing write code
}
```

**Step 3: Commit**

```bash
git add src/shared/SettingsDefaultsManager.ts src/cli/handlers/context.ts
git commit -m "feat: add CLAUDE_MEM_AUTO_MEMORY setting to control memory bridge (#32)"
```

---

## Phase 3: Build and Verify

### Task 13: Full integration test

**Agent Assignment:** `integration` (or orchestrator)
**Depends on:** All above tasks merged

**Step 1: Build**

Run: `npm run build`
Expected: Clean build.

**Step 2: Run all tests**

Run: `bun test tests/`
Expected: All pass.

**Step 3: Test agent-monitor end-to-end**

```bash
bun scripts/agent-monitor.ts status --all
bun scripts/agent-monitor.ts --help
```

**Step 4: Test memory bridge**

```bash
# Start the worker
npm run worker:start

# Trigger SessionStart manually (or start a Claude session)
# Check that MEMORY.md was written
cat ~/.claude/projects/-Users-seb-AI-mem-claude/memory/MEMORY.md
```

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration test findings"
```

---

## Summary

| Track | Tasks | Issue | Agent | Lines (est.) |
|-------|-------|-------|-------|-------------|
| A. Tmux Monitor | 1-6 | #31 | `monitor` | ~300 |
| B. Research | 7-8 | #32 | `memory-research` | ~50 (docs) |
| B. Implementation | 9-12 | #32 | `memory-bridge` | ~200 |
| Integration | 13 | both | orchestrator | ~10 |
| **Total** | **13** | | **3-4 agents** | **~560** |

## Dependencies & Agent Distribution

```
Round 1 (parallel):
  ┌─ Agent "monitor":          Tasks 1-6 (Track A, branch feat/tmux-agent-monitor)
  └─ Agent "memory-research":  Tasks 7-8 (Track B research, branch feat/auto-memory-bridge)

Round 2 (after research):
  └─ Agent "memory-bridge":    Tasks 9-12 (Track B implementation, same branch)

Round 3 (after merge):
  └─ Orchestrator:             Task 13 (integration verification)
```

Round 1 agents are fully independent — no shared files, different branches.
Round 2 depends on Task 8 research findings (may change path encoding or tag strategy).
Round 3 runs after all branches are merged into the feature branch.
