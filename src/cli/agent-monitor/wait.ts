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
