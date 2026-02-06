/**
 * Agentspace Config Tests
 *
 * Tests for the agentspace config loader (loadAgentspaceConfig).
 * Uses temp directories for file system isolation.
 *
 * Test cases:
 * 1. File doesn't exist — creates file with defaults and returns defaults
 * 2. Directory doesn't exist — creates directory and file
 * 3. File exists with valid content — returns parsed config
 * 4. File exists but is empty/corrupt — returns defaults
 * 5. Schema validation — runtimes must be object, each runtime needs command
 * 6. Custom config path — works with any provided path
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadAgentspaceConfig, AGENTSPACE_DEFAULTS, type AgentspaceConfig } from '../../src/shared/agentspace-config.js';

describe('agentspace-config', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `agentspace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, 'agentspace.json');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('AGENTSPACE_DEFAULTS', () => {
    it('should have runtimes with claude-code entry', () => {
      expect(AGENTSPACE_DEFAULTS.runtimes).toBeDefined();
      expect(AGENTSPACE_DEFAULTS.runtimes['claude-code']).toBeDefined();
      expect(AGENTSPACE_DEFAULTS.runtimes['claude-code'].command).toBe('claude');
      expect(AGENTSPACE_DEFAULTS.runtimes['claude-code'].flags).toBe('--dangerously-skip-permissions');
      expect(AGENTSPACE_DEFAULTS.runtimes['claude-code']['agent-teams']).toBe(false);
    });

    it('should have empty remote-hosts and monitors', () => {
      expect(AGENTSPACE_DEFAULTS['remote-hosts']).toEqual({});
      expect(AGENTSPACE_DEFAULTS.monitors).toEqual({});
    });
  });

  describe('loadAgentspaceConfig', () => {
    describe('file does not exist', () => {
      it('should create file with defaults when file does not exist', () => {
        expect(existsSync(configPath)).toBe(false);

        const result = loadAgentspaceConfig(configPath);

        expect(existsSync(configPath)).toBe(true);
        expect(result).toEqual(AGENTSPACE_DEFAULTS);
      });

      it('should write valid JSON to the created file', () => {
        loadAgentspaceConfig(configPath);

        const content = readFileSync(configPath, 'utf-8');
        expect(() => JSON.parse(content)).not.toThrow();
      });

      it('should write pretty-printed JSON (2-space indent)', () => {
        loadAgentspaceConfig(configPath);

        const content = readFileSync(configPath, 'utf-8');
        expect(content).toContain('\n');
        expect(content).toContain('  "runtimes"');
      });
    });

    describe('directory does not exist', () => {
      it('should create directory and file when parent directory does not exist', () => {
        const nestedPath = join(tempDir, 'nested', 'deep', 'agentspace.json');
        expect(existsSync(join(tempDir, 'nested'))).toBe(false);

        const result = loadAgentspaceConfig(nestedPath);

        expect(existsSync(join(tempDir, 'nested', 'deep'))).toBe(true);
        expect(existsSync(nestedPath)).toBe(true);
        expect(result).toEqual(AGENTSPACE_DEFAULTS);
      });
    });

    describe('file exists with valid content', () => {
      it('should return parsed config when file has valid JSON', () => {
        const customConfig = {
          runtimes: {
            'claude-code': {
              command: '/usr/local/bin/claude',
              flags: '--verbose',
              'agent-teams': true,
            },
          },
          'remote-hosts': {},
          monitors: {},
        };
        writeFileSync(configPath, JSON.stringify(customConfig));

        const result = loadAgentspaceConfig(configPath);

        expect(result.runtimes['claude-code'].command).toBe('/usr/local/bin/claude');
        expect(result.runtimes['claude-code'].flags).toBe('--verbose');
        expect(result.runtimes['claude-code']['agent-teams']).toBe(true);
      });

      it('should merge with defaults for missing top-level keys', () => {
        const partialConfig = {
          runtimes: {
            'claude-code': {
              command: 'custom-claude',
              flags: '--custom',
              'agent-teams': false,
            },
          },
        };
        writeFileSync(configPath, JSON.stringify(partialConfig));

        const result = loadAgentspaceConfig(configPath);

        expect(result.runtimes['claude-code'].command).toBe('custom-claude');
        expect(result['remote-hosts']).toEqual({});
        expect(result.monitors).toEqual({});
      });

      it('should preserve extra runtimes beyond claude-code', () => {
        const configWithExtra = {
          runtimes: {
            'claude-code': {
              command: 'claude',
              flags: '--dangerously-skip-permissions',
              'agent-teams': false,
            },
            'custom-runtime': {
              command: 'my-agent',
              flags: '--fast',
            },
          },
          'remote-hosts': {},
          monitors: {},
        };
        writeFileSync(configPath, JSON.stringify(configWithExtra));

        const result = loadAgentspaceConfig(configPath);

        expect(result.runtimes['custom-runtime']).toBeDefined();
        expect(result.runtimes['custom-runtime'].command).toBe('my-agent');
      });
    });

    describe('file exists but is empty or corrupt', () => {
      it('should return defaults when file is empty', () => {
        writeFileSync(configPath, '');

        const result = loadAgentspaceConfig(configPath);

        expect(result).toEqual(AGENTSPACE_DEFAULTS);
      });

      it('should return defaults when file contains invalid JSON', () => {
        writeFileSync(configPath, 'not valid json {{{{');

        const result = loadAgentspaceConfig(configPath);

        expect(result).toEqual(AGENTSPACE_DEFAULTS);
      });

      it('should return defaults when file contains only whitespace', () => {
        writeFileSync(configPath, '   \n\t  ');

        const result = loadAgentspaceConfig(configPath);

        expect(result).toEqual(AGENTSPACE_DEFAULTS);
      });

      it('should return defaults when file contains null', () => {
        writeFileSync(configPath, 'null');

        const result = loadAgentspaceConfig(configPath);

        expect(result).toEqual(AGENTSPACE_DEFAULTS);
      });

      it('should return defaults when file contains array instead of object', () => {
        writeFileSync(configPath, '["array", "not", "object"]');

        const result = loadAgentspaceConfig(configPath);

        expect(result).toEqual(AGENTSPACE_DEFAULTS);
      });

      it('should return defaults when file contains primitive value', () => {
        writeFileSync(configPath, '"just a string"');

        const result = loadAgentspaceConfig(configPath);

        expect(result).toEqual(AGENTSPACE_DEFAULTS);
      });
    });

    describe('schema validation', () => {
      it('should return defaults when runtimes is not an object', () => {
        writeFileSync(configPath, JSON.stringify({ runtimes: 'not-an-object' }));

        const result = loadAgentspaceConfig(configPath);

        expect(result).toEqual(AGENTSPACE_DEFAULTS);
      });

      it('should return defaults when runtimes is an array', () => {
        writeFileSync(configPath, JSON.stringify({ runtimes: ['a', 'b'] }));

        const result = loadAgentspaceConfig(configPath);

        expect(result).toEqual(AGENTSPACE_DEFAULTS);
      });

      it('should return defaults when a runtime is missing command field', () => {
        writeFileSync(configPath, JSON.stringify({
          runtimes: {
            'claude-code': { flags: '--test' },
          },
        }));

        const result = loadAgentspaceConfig(configPath);

        expect(result).toEqual(AGENTSPACE_DEFAULTS);
      });

      it('should return defaults when command is not a string', () => {
        writeFileSync(configPath, JSON.stringify({
          runtimes: {
            'claude-code': { command: 123, flags: '--test' },
          },
        }));

        const result = loadAgentspaceConfig(configPath);

        expect(result).toEqual(AGENTSPACE_DEFAULTS);
      });
    });
  });
});
