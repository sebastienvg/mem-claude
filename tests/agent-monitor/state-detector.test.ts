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
