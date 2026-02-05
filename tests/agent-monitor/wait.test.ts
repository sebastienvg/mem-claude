import { describe, it, expect } from 'bun:test';
import { AgentState } from '../../src/cli/agent-monitor/state-detector.js';

// We'll test the logic, not the actual tmux interaction
describe('waitForAgent logic', () => {
  it('should resolve immediately if agent is already done', async () => {
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
