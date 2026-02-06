/**
 * Store observation function
 * Extracted from SessionStore.ts for modular organization
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../../utils/logger.js';
import type { ObservationInput, StoreObservationResult } from './types.js';
import { VALID_VISIBILITIES } from './types.js';

/**
 * Validate visibility value
 * @throws Error if visibility is invalid
 */
function validateVisibility(visibility?: string): void {
  if (visibility && !VALID_VISIBILITIES.includes(visibility as any)) {
    throw new Error(`Invalid visibility: ${visibility}. Must be one of: ${VALID_VISIBILITIES.join(', ')}`);
  }
}

/**
 * Store an observation (from SDK parsing)
 * Assumes session already exists (created by hook)
 *
 * @param db - Database instance
 * @param memorySessionId - SDK memory session ID
 * @param project - Project name
 * @param observation - Observation data including optional agent metadata
 * @param promptNumber - Optional prompt number
 * @param discoveryTokens - Token count for discovery (default 0)
 * @param overrideTimestampEpoch - Optional timestamp override for backlog processing
 */
export function storeObservation(
  db: Database,
  memorySessionId: string,
  project: string,
  observation: ObservationInput,
  promptNumber?: number,
  discoveryTokens: number = 0,
  overrideTimestampEpoch?: number
): StoreObservationResult {
  // Validate visibility if provided
  validateVisibility(observation.visibility);

  // Use defaults for agent metadata if not provided
  const agent = observation.agent ?? 'legacy';
  const department = observation.department ?? 'default';
  const visibility = observation.visibility ?? 'project';

  // Use override timestamp if provided (for processing backlog messages with original timestamps)
  const timestampEpoch = overrideTimestampEpoch ?? Date.now();
  const timestampIso = new Date(timestampEpoch).toISOString();

  const stmt = db.prepare(`
    INSERT INTO observations
    (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
     files_read, files_modified, prompt_number, discovery_tokens, agent, department, visibility,
     bead_id, created_at, created_at_epoch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    memorySessionId,
    project,
    observation.type,
    observation.title,
    observation.subtitle,
    JSON.stringify(observation.facts),
    observation.narrative,
    JSON.stringify(observation.concepts),
    JSON.stringify(observation.files_read),
    JSON.stringify(observation.files_modified),
    promptNumber || null,
    discoveryTokens,
    agent,
    department,
    visibility,
    observation.bead_id || null,
    timestampIso,
    timestampEpoch
  );

  return {
    id: Number(result.lastInsertRowid),
    createdAtEpoch: timestampEpoch
  };
}
