import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { buildBriefingContent, writeMemoryBriefing, BRIEFING_START_TAG, BRIEFING_END_TAG } from '../../src/utils/memory-briefing.js';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

describe('tag constants', () => {
  it('should use claude-mem-briefing tags', () => {
    expect(BRIEFING_START_TAG).toBe('<claude-mem-briefing>');
    expect(BRIEFING_END_TAG).toBe('</claude-mem-briefing>');
  });
});

describe('buildBriefingContent', () => {
  it('should include project name in header', () => {
    const content = buildBriefingContent('github.com/user/repo', []);
    expect(content).toContain('github.com/user/repo');
  });

  it('should show message for empty observations', () => {
    const content = buildBriefingContent('test-project', []);
    expect(content).toContain('No recent observations');
  });

  it('should include observation summaries', () => {
    const observations = [
      { title: 'Added auth system', type: 'feature', time: '3:00 PM' },
      { title: 'Fixed login bug', type: 'bugfix', time: '4:00 PM' },
    ];
    const content = buildBriefingContent('test-project', observations);
    expect(content).toContain('Added auth system');
    expect(content).toContain('Fixed login bug');
  });

  it('should stay well under 200-line limit', () => {
    const manyObs = Array.from({ length: 100 }, (_, i) => ({
      title: `Observation ${i}`,
      type: 'discovery',
      time: '1:00 PM',
    }));
    const content = buildBriefingContent('test', manyObs);
    const lines = content.split('\n');
    expect(lines.length).toBeLessThanOrEqual(190);
  });
});

describe('writeMemoryBriefing', () => {
  const testDir = join(import.meta.dir, '..', '..', '.test-memory-briefing');
  const memoryDir = join(testDir, 'memory');
  const memoryPath = join(memoryDir, 'MEMORY.md');

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should create directory and file if they do not exist', () => {
    writeMemoryBriefing(memoryPath, 'test briefing');
    expect(existsSync(memoryPath)).toBe(true);
    const content = readFileSync(memoryPath, 'utf-8');
    expect(content).toContain(BRIEFING_START_TAG);
    expect(content).toContain('test briefing');
    expect(content).toContain(BRIEFING_END_TAG);
  });

  it('should preserve content outside tags in existing file', () => {
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(memoryPath, '# My Notes\n\nThese are my personal notes.\n');
    writeMemoryBriefing(memoryPath, 'briefing content');
    const content = readFileSync(memoryPath, 'utf-8');
    expect(content).toContain('# My Notes');
    expect(content).toContain('These are my personal notes.');
    expect(content).toContain('briefing content');
  });

  it('should replace existing tagged section', () => {
    mkdirSync(memoryDir, { recursive: true });
    const existing = `${BRIEFING_START_TAG}\nold briefing\n${BRIEFING_END_TAG}\n\n# User Notes\nImportant stuff.\n`;
    writeFileSync(memoryPath, existing);
    writeMemoryBriefing(memoryPath, 'new briefing');
    const content = readFileSync(memoryPath, 'utf-8');
    expect(content).not.toContain('old briefing');
    expect(content).toContain('new briefing');
    expect(content).toContain('# User Notes');
    expect(content).toContain('Important stuff.');
  });

  it('should prepend tags when no existing tags', () => {
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(memoryPath, '# Existing content\n');
    writeMemoryBriefing(memoryPath, 'prepended briefing');
    const content = readFileSync(memoryPath, 'utf-8');
    // Tagged section should come before existing content
    const tagIdx = content.indexOf(BRIEFING_START_TAG);
    const existingIdx = content.indexOf('# Existing content');
    expect(tagIdx).toBeLessThan(existingIdx);
  });
});
