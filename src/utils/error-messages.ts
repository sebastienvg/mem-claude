/**
 * Platform-aware error message generator for worker connection failures
 */

export interface WorkerErrorMessageOptions {
  port?: number;
  url?: string;  // Full worker URL for container/remote scenarios
  includeSkillFallback?: boolean;
  customPrefix?: string;
  actualError?: string;
}

/**
 * Generate platform-specific worker restart instructions
 * @param options Configuration for error message generation
 * @returns Formatted error message with platform-specific paths and commands
 */
export function getWorkerRestartInstructions(
  options: WorkerErrorMessageOptions = {}
): string {
  const {
    port,
    url,
    includeSkillFallback = false,
    customPrefix,
    actualError
  } = options;

  // Build error message
  const prefix = customPrefix || 'Worker service connection failed.';
  const connectionInfo = url ? ` at ${url}` : (port ? ` (port ${port})` : '');

  let message = `${prefix}${connectionInfo}\n\n`;
  message += `To restart the worker:\n`;
  message += `1. Exit Claude Code completely\n`;
  message += `2. Run: npm run worker:restart\n`;
  message += `3. Restart Claude Code`;

  // Add container/remote hint if URL is provided
  if (url && !url.includes('127.0.0.1') && !url.includes('localhost')) {
    message += `\n\nFor container/remote workers, verify the worker is running and accessible.`;
  }

  // Add URL override hint
  message += `\n\nTip: Set CLAUDE_MEM_WORKER_URL env var to override the worker URL.`;

  if (includeSkillFallback) {
    message += `\n\nIf that doesn't work, try: /troubleshoot`;
  }

  // Prepend actual error if provided
  if (actualError) {
    message = `Worker Error: ${actualError}\n\n${message}`;
  }

  return message;
}
