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
