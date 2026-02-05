import { describe, it, expect } from 'bun:test';
import { encodeProjectPath, getAutoMemoryDir, getAutoMemoryFilePath } from '../../src/utils/auto-memory-path.js';
import { join } from 'path';
import { homedir } from 'os';

describe('encodeProjectPath', () => {
  it('should replace slashes with dashes', () => {
    expect(encodeProjectPath('/Users/seb/AI/mem-claude')).toBe('-Users-seb-AI-mem-claude');
  });

  it('should replace dots with dashes', () => {
    expect(encodeProjectPath('/Users/seb/.hidden/project')).toBe('-Users-seb--hidden-project');
  });

  it('should truncate at 89 characters', () => {
    const longPath = '/Users/seb/very/deeply/nested/path/that/exceeds/the/maximum/character/limit/for/encoding/directories';
    expect(encodeProjectPath(longPath).length).toBeLessThanOrEqual(89);
  });

  it('should handle paths without leading slash', () => {
    expect(encodeProjectPath('Users/seb/project')).toBe('Users-seb-project');
  });

  it('should preserve existing dashes', () => {
    expect(encodeProjectPath('/Users/seb/mem-claude')).toBe('-Users-seb-mem-claude');
  });
});

describe('getAutoMemoryDir', () => {
  it('should return correct memory directory path', () => {
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
