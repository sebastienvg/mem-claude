/**
 * Agentspace Config Loader
 *
 * Loads and validates ~/.claude-mem/agentspace.json.
 * Creates file with defaults if missing. Graceful fallback on errors.
 *
 * Pattern follows SettingsDefaultsManager.loadFromFile().
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { join } from 'path';
import { homedir } from 'os';

export interface RuntimeConfig {
  command: string;
  flags?: string;
  'agent-teams'?: boolean;
  [key: string]: unknown;
}

export interface AgentspaceConfig {
  runtimes: Record<string, RuntimeConfig>;
  'remote-hosts': Record<string, unknown>;
  monitors: Record<string, unknown>;
  [key: string]: unknown;
}

export const AGENTSPACE_DEFAULTS: AgentspaceConfig = {
  runtimes: {
    'claude-code': {
      command: 'claude',
      flags: '--dangerously-skip-permissions',
      'agent-teams': false,
    },
  },
  'remote-hosts': {},
  monitors: {},
};

const DEFAULT_CONFIG_PATH = join(homedir(), '.claude-mem', 'agentspace.json');

function validateSchema(config: unknown): config is AgentspaceConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }

  const obj = config as Record<string, unknown>;

  if (obj.runtimes !== undefined) {
    if (typeof obj.runtimes !== 'object' || obj.runtimes === null || Array.isArray(obj.runtimes)) {
      console.warn('[AGENTSPACE] Invalid schema: runtimes must be an object');
      return false;
    }

    const runtimes = obj.runtimes as Record<string, unknown>;
    for (const [name, runtime] of Object.entries(runtimes)) {
      if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
        console.warn(`[AGENTSPACE] Invalid schema: runtime "${name}" must be an object`);
        return false;
      }
      const rt = runtime as Record<string, unknown>;
      if (typeof rt.command !== 'string') {
        console.warn(`[AGENTSPACE] Invalid schema: runtime "${name}" must have a string "command" field`);
        return false;
      }
    }
  }

  return true;
}

export function loadAgentspaceConfig(configPath?: string): AgentspaceConfig {
  const path = configPath ?? DEFAULT_CONFIG_PATH;

  try {
    if (!existsSync(path)) {
      try {
        const dir = dirname(path);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(path, JSON.stringify(AGENTSPACE_DEFAULTS, null, 2), 'utf-8');
        console.log('[AGENTSPACE] Created config file with defaults:', path);
      } catch (error) {
        console.warn('[AGENTSPACE] Failed to create config file, using in-memory defaults:', path, error);
      }
      return { ...AGENTSPACE_DEFAULTS };
    }

    const data = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(data);

    if (!validateSchema(parsed)) {
      console.warn('[AGENTSPACE] Schema validation failed, using defaults');
      return { ...AGENTSPACE_DEFAULTS };
    }

    // Merge with defaults
    return {
      ...AGENTSPACE_DEFAULTS,
      ...parsed,
      runtimes: {
        ...AGENTSPACE_DEFAULTS.runtimes,
        ...(parsed.runtimes || {}),
      },
    };
  } catch (error) {
    console.warn('[AGENTSPACE] Failed to load config, using defaults:', path, error);
    return { ...AGENTSPACE_DEFAULTS };
  }
}
