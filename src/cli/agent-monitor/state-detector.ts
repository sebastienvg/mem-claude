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
