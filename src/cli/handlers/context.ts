/**
 * Context Handler - SessionStart
 *
 * Extracted from context-hook.ts - calls worker to generate context.
 * Returns context as hookSpecificOutput for Claude Code to inject.
 * Also writes a briefing to Claude Code's auto memory MEMORY.md.
 */

import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { ensureWorkerRunning, getWorkerUrl } from '../../shared/worker-utils.js';
import { getProjectContext } from '../../utils/project-name.js';
import { getAutoMemoryFilePath } from '../../utils/auto-memory-path.js';
import { buildBriefingContent, writeMemoryBriefing } from '../../utils/memory-briefing.js';

export const contextHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    // Ensure worker is running before any other logic
    await ensureWorkerRunning();

    const cwd = input.cwd ?? process.cwd();
    const context = getProjectContext(cwd);
    const baseUrl = getWorkerUrl();

    // Pass all projects (parent + worktree if applicable) for unified timeline
    const projectsParam = context.allProjects.join(',');
    const url = `${baseUrl}/api/context/inject?projects=${encodeURIComponent(projectsParam)}`;

    // Note: Removed AbortSignal.timeout due to Windows Bun cleanup issue (libuv assertion)
    // Worker service has its own timeouts, so client-side timeout is redundant
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Context generation failed: ${response.status}`);
    }

    const result = await response.text();
    const additionalContext = result.trim();

    // Write briefing to Claude Code's auto memory MEMORY.md
    // Fire-and-forget: never fail SessionStart over memory briefing
    try {
      const briefingUrl = `${baseUrl}/api/memory/briefing?project=${encodeURIComponent(context.primary)}`;
      const briefingResponse = await fetch(briefingUrl);
      if (briefingResponse.ok) {
        const briefingData = await briefingResponse.json() as { project: string; observations: Array<{ title: string; type: string; time: string }> };
        const briefing = buildBriefingContent(context.primary, briefingData.observations);
        const memoryPath = getAutoMemoryFilePath(cwd);
        writeMemoryBriefing(memoryPath, briefing);
      }
    } catch {
      // Fire-and-forget: don't fail SessionStart over memory briefing
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext
      }
    };
  }
};
