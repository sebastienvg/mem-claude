/**
 * Agent Service Error Classes
 * Custom errors for agent authentication and authorization
 */

/**
 * Thrown when an agent ID doesn't match the required format.
 * Valid format: user@host (alphanumeric, dots, dashes, underscores)
 */
export class AgentIdFormatError extends Error {
  constructor(id: string) {
    super(`Invalid agent ID format: ${id}. Expected: user@host`);
    this.name = 'AgentIdFormatError';
  }
}

/**
 * Thrown when an agent is temporarily locked due to too many failed attempts.
 * Includes the unlock time for client retry logic.
 */
export class AgentLockedError extends Error {
  public readonly lockedUntil: Date;

  constructor(id: string, lockedUntil: Date) {
    super(`Agent ${id} is locked until ${lockedUntil.toISOString()}`);
    this.name = 'AgentLockedError';
    this.lockedUntil = lockedUntil;
  }
}
