import path from "path";
import { homedir } from "os";
import { readFileSync } from "fs";
import { logger } from "../utils/logger.js";
import { HOOK_TIMEOUTS, getTimeout } from "./hook-constants.js";
import { SettingsDefaultsManager } from "./SettingsDefaultsManager.js";
import { getWorkerRestartInstructions } from "../utils/error-messages.js";

const MARKETPLACE_ROOT = path.join(homedir(), '.claude', 'plugins', 'marketplaces', 'thedotmack');

// Named constants for health checks
const HEALTH_CHECK_TIMEOUT_MS = getTimeout(HOOK_TIMEOUTS.HEALTH_CHECK);

// Cache to avoid repeated settings file reads
let cachedPort: number | null = null;
let cachedHost: string | null = null;
let cachedUrl: string | null = null;

/**
 * Get the worker port number
 * Priority: env var > settings file > default (37777)
 * Caches the port value to avoid repeated reads
 */
export function getWorkerPort(): number {
  if (cachedPort !== null) {
    return cachedPort;
  }

  // Environment variable takes priority (for container deployments)
  if (process.env.CLAUDE_MEM_WORKER_PORT) {
    cachedPort = parseInt(process.env.CLAUDE_MEM_WORKER_PORT, 10);
    return cachedPort;
  }

  const settingsPath = path.join(SettingsDefaultsManager.get('CLAUDE_MEM_DATA_DIR'), 'settings.json');
  const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
  cachedPort = parseInt(settings.CLAUDE_MEM_WORKER_PORT, 10);
  return cachedPort;
}

/**
 * Get the worker host address
 * Priority: env var > settings file > default (127.0.0.1)
 * Caches the host value to avoid repeated reads
 */
export function getWorkerHost(): string {
  if (cachedHost !== null) {
    return cachedHost;
  }

  // Environment variable takes priority (for container deployments)
  if (process.env.CLAUDE_MEM_WORKER_HOST) {
    cachedHost = process.env.CLAUDE_MEM_WORKER_HOST;
    return cachedHost;
  }

  const settingsPath = path.join(SettingsDefaultsManager.get('CLAUDE_MEM_DATA_DIR'), 'settings.json');
  const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
  cachedHost = settings.CLAUDE_MEM_WORKER_HOST;
  return cachedHost;
}

/**
 * Clear the cached port, host, and URL values
 * Call this when settings are updated to force re-reading from file
 */
export function clearPortCache(): void {
  cachedPort = null;
  cachedHost = null;
  cachedUrl = null;
}

/**
 * Get the full worker URL
 * Priority: CLAUDE_MEM_WORKER_URL env var > settings file URL > construct from host+port
 * This supports both native and containerized worker deployments
 */
export function getWorkerUrl(): string {
  if (cachedUrl !== null) {
    return cachedUrl;
  }

  // 1. Check environment variable first (highest priority)
  if (process.env.CLAUDE_MEM_WORKER_URL) {
    cachedUrl = process.env.CLAUDE_MEM_WORKER_URL;
    return cachedUrl;
  }

  // 2. Check settings file for explicit URL
  const settingsPath = path.join(SettingsDefaultsManager.get('CLAUDE_MEM_DATA_DIR'), 'settings.json');
  const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
  if (settings.CLAUDE_MEM_WORKER_URL) {
    cachedUrl = settings.CLAUDE_MEM_WORKER_URL;
    return cachedUrl;
  }

  // 3. Construct from host + port (default behavior)
  const host = getWorkerHost();
  const port = getWorkerPort();
  cachedUrl = `http://${host}:${port}`;
  return cachedUrl;
}

/**
 * Check if worker is responsive and fully initialized by trying the readiness endpoint
 * Changed from /health to /api/readiness to ensure MCP initialization is complete
 */
async function isWorkerHealthy(): Promise<boolean> {
  const baseUrl = getWorkerUrl();
  // Note: Removed AbortSignal.timeout to avoid Windows Bun cleanup issue (libuv assertion)
  const response = await fetch(`${baseUrl}/api/readiness`);
  return response.ok;
}

/**
 * Get the current plugin version from package.json
 */
function getPluginVersion(): string {
  const packageJsonPath = path.join(MARKETPLACE_ROOT, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  return packageJson.version;
}

/**
 * Get the running worker's version from the API
 */
async function getWorkerVersion(): Promise<string> {
  const baseUrl = getWorkerUrl();
  // Note: Removed AbortSignal.timeout to avoid Windows Bun cleanup issue (libuv assertion)
  const response = await fetch(`${baseUrl}/api/version`);
  if (!response.ok) {
    throw new Error(`Failed to get worker version: ${response.status}`);
  }
  const data = await response.json() as { version: string };
  return data.version;
}

/**
 * Check if worker version matches plugin version
 * Note: Auto-restart on version mismatch is now handled in worker-service.ts start command (issue #484)
 * This function logs for informational purposes only
 */
async function checkWorkerVersion(): Promise<void> {
  const pluginVersion = getPluginVersion();
  const workerVersion = await getWorkerVersion();

  if (pluginVersion !== workerVersion) {
    // Just log debug info - auto-restart handles the mismatch in worker-service.ts
    logger.debug('SYSTEM', 'Version check', {
      pluginVersion,
      workerVersion,
      note: 'Mismatch will be auto-restarted by worker-service start command'
    });
  }
}


/**
 * Check if the worker URL points to a remote host (not localhost)
 */
function isRemoteWorker(): boolean {
  const url = getWorkerUrl();
  try {
    const { hostname } = new URL(url);
    const localHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    return !localHosts.includes(hostname);
  } catch {
    return false;
  }
}

/**
 * Ensure worker service is running
 * For remote workers: just health-check, don't try to start a local process
 * For local workers: polls until ready (assumes worker-service.cjs start was called by hooks.json)
 */
export async function ensureWorkerRunning(): Promise<void> {
  const remote = isRemoteWorker();
  const maxRetries = remote ? 15 : 75;  // remote: 3s, local: 15s
  const pollInterval = 200;

  for (let i = 0; i < maxRetries; i++) {
    try {
      if (await isWorkerHealthy()) {
        if (!remote) {
          await checkWorkerVersion();  // only check version for local workers
        }
        return;
      }
    } catch (e) {
      logger.debug('SYSTEM', `${remote ? 'Remote' : 'Local'} worker health check failed, will retry`, {
        attempt: i + 1,
        maxRetries,
        error: e instanceof Error ? e.message : String(e)
      });
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }

  throw new Error(getWorkerRestartInstructions({
    url: getWorkerUrl(),
    customPrefix: remote
      ? `Remote worker at ${getWorkerUrl()} is not responding.`
      : 'Worker did not become ready within 15 seconds.'
  }));
}
