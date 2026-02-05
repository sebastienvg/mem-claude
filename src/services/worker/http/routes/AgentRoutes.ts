/**
 * Agent Routes
 *
 * Exposes AgentService as REST endpoints: register, verify, me, rotate-key, revoke.
 * All endpoints use BaseRouteHandler patterns for error handling and validation.
 */

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { AgentService, AgentLockedError, AgentIdFormatError } from '../../../agents/AgentService.js';
import { logger } from '../../../../utils/logger.js';

export class AgentRoutes extends BaseRouteHandler {
  constructor(private agentService: AgentService) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.post('/api/agents/register', this.handleRegister.bind(this));
    app.post('/api/agents/verify', this.handleVerify.bind(this));
    app.get('/api/agents/me', this.handleMe.bind(this));
    app.post('/api/agents/rotate-key', this.handleRotateKey.bind(this));
    app.post('/api/agents/revoke', this.handleRevoke.bind(this));
  }

  private extractBearerToken(req: Request): string | null {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    return auth.slice(7);
  }

  /**
   * Authenticate request via Bearer token.
   * Returns the authenticated agent, or null if response was already sent.
   */
  private authenticateBearer(req: Request, res: Response): ReturnType<AgentService['findAgentByKey']> | null {
    const token = this.extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return null;
    }

    try {
      const agent = this.agentService.findAgentByKey(token);
      if (!agent) {
        res.status(401).json({ error: 'Invalid or expired API key' });
        return null;
      }
      return agent;
    } catch (error) {
      if (error instanceof AgentLockedError) {
        res.status(429).json({ error: error.message, lockedUntil: error.lockedUntil.toISOString() });
        return null;
      }
      throw error;
    }
  }

  /**
   * Register new agent or update existing
   * POST /api/agents/register
   * Body: { id, department, permissions? }
   */
  private handleRegister = this.wrapHandler((req: Request, res: Response): void => {
    if (!this.validateRequired(req, res, ['id', 'department'])) return;

    const { id, department, permissions, spawned_by, bead_id, role } = req.body;

    try {
      const result = this.agentService.registerAgent({ id, department, permissions, spawned_by, bead_id, role });
      res.json({
        id: result.agent.id,
        ...(result.apiKey && { apiKey: result.apiKey }),
        department: result.agent.department,
        ...(result.agent.expires_at && { expiresAt: result.agent.expires_at }),
        ...(result.agent.spawned_by && { spawned_by: result.agent.spawned_by }),
        ...(result.agent.bead_id && { bead_id: result.agent.bead_id }),
        ...(result.agent.role && { role: result.agent.role }),
      });
    } catch (error) {
      if (error instanceof AgentIdFormatError) {
        this.badRequest(res, error.message);
        return;
      }
      throw error;
    }
  });

  /**
   * Verify agent key
   * POST /api/agents/verify
   * Body: { id, apiKey }
   */
  private handleVerify = this.wrapHandler((req: Request, res: Response): void => {
    if (!this.validateRequired(req, res, ['id', 'apiKey'])) return;

    const { id, apiKey } = req.body;

    try {
      const verified = this.agentService.verifyAgent(id, apiKey);
      if (!verified) {
        res.status(401).json({ error: 'Invalid agent ID or API key' });
        return;
      }
      res.json({ verified: true });
    } catch (error) {
      if (error instanceof AgentLockedError) {
        res.status(429).json({ error: error.message, lockedUntil: error.lockedUntil.toISOString() });
        return;
      }
      throw error;
    }
  });

  /**
   * Get agent info for authenticated agent
   * GET /api/agents/me
   * Requires Authorization: Bearer <key>
   */
  private handleMe = this.wrapHandler((req: Request, res: Response): void => {
    const agent = this.authenticateBearer(req, res);
    if (!agent) return;

    res.json(agent);
  });

  /**
   * Rotate API key for an agent
   * POST /api/agents/rotate-key
   * Body: { id }
   * Requires Authorization: Bearer <key>
   */
  private handleRotateKey = this.wrapHandler((req: Request, res: Response): void => {
    if (!this.authenticateBearer(req, res)) return;
    if (!this.validateRequired(req, res, ['id'])) return;

    const { id } = req.body;
    const newKey = this.agentService.rotateApiKey(id);
    if (!newKey) {
      this.notFound(res, `Agent ${id} not found`);
      return;
    }

    const updatedAgent = this.agentService.getAgent(id);
    res.json({
      apiKey: newKey,
      expiresAt: updatedAgent?.expires_at ?? null,
    });
  });

  /**
   * Revoke all keys for an agent
   * POST /api/agents/revoke
   * Body: { id }
   * Requires Authorization: Bearer <key>
   */
  private handleRevoke = this.wrapHandler((req: Request, res: Response): void => {
    if (!this.authenticateBearer(req, res)) return;
    if (!this.validateRequired(req, res, ['id'])) return;

    const { id } = req.body;
    const revoked = this.agentService.revokeApiKey(id);
    if (!revoked) {
      this.notFound(res, `Agent ${id} not found`);
      return;
    }

    res.json({ revoked: true });
  });
}
