/**
 * Authentication Middleware Tests
 *
 * Tests for createAuthMiddleware and createOptionalAuthMiddleware.
 * Following TDD: These tests verify correct handling of auth headers,
 * agent verification, and error responses.
 */

import { describe, it, expect, beforeEach, afterEach, mock, type Mock } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { AgentService, AgentLockedError } from '../../src/services/agents/AgentService.js';
import {
  createAuthMiddleware,
  createOptionalAuthMiddleware,
  type AuthenticatedRequest,
} from '../../src/services/worker/http/middleware/auth.js';
import type { Response, NextFunction } from 'express';
import type { Database } from 'bun:sqlite';

describe('Auth Middleware', () => {
  let db: Database;
  let agentService: AgentService;
  let middleware: ReturnType<typeof createAuthMiddleware>;
  let mockReq: Partial<AuthenticatedRequest>;
  let mockRes: Partial<Response>;
  let mockNext: Mock<NextFunction>;
  let apiKey: string;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
    agentService = new AgentService(db);
    middleware = createAuthMiddleware(agentService);

    // Register and verify a test agent
    const result = agentService.registerAgent({
      id: 'test@host',
      department: 'engineering',
    });
    apiKey = result.apiKey!;
    agentService.verifyAgent('test@host', apiKey);

    mockReq = {
      headers: {},
      ip: '127.0.0.1',
    };

    mockRes = {
      status: mock((code: number) => mockRes as Response),
      json: mock((data: any) => mockRes as Response),
    };

    mockNext = mock(() => {});
  });

  afterEach(() => {
    db.close();
  });

  describe('createAuthMiddleware', () => {
    it('should return 401 for missing Authorization header', () => {
      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'UNAUTHORIZED',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for empty Authorization header', () => {
      mockReq.headers = { authorization: '' };

      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for non-Bearer token', () => {
      mockReq.headers = { authorization: 'Basic abc123' };

      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'UNAUTHORIZED',
          message: expect.stringContaining('Bearer'),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 for invalid API key', () => {
      mockReq.headers = { authorization: 'Bearer cm_invalidkey123456789012345' };

      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'UNAUTHORIZED',
          message: expect.stringContaining('Invalid'),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 403 for unverified agent', () => {
      // Register but don't verify
      const unverified = agentService.registerAgent({
        id: 'unverified@host',
        department: 'test',
      });

      mockReq.headers = { authorization: `Bearer ${unverified.apiKey}` };

      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'FORBIDDEN',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 429 for locked agent', () => {
      // Lock the agent by setting locked_until_epoch in the future
      db.run(
        `
        UPDATE agents SET locked_until_epoch = ?
        WHERE id = 'test@host'
      `,
        [Math.floor(Date.now() / 1000) + 300]
      );

      mockReq.headers = { authorization: `Bearer ${apiKey}` };

      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(429);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'TOO_MANY_REQUESTS',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should include retryAfter in 429 response', () => {
      const lockDuration = 300; // 5 minutes
      db.run(
        `
        UPDATE agents SET locked_until_epoch = ?
        WHERE id = 'test@host'
      `,
        [Math.floor(Date.now() / 1000) + lockDuration]
      );

      mockReq.headers = { authorization: `Bearer ${apiKey}` };

      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(429);
      const jsonCall = (mockRes.json as Mock<any>).mock.calls[0];
      expect(jsonCall[0]).toHaveProperty('retryAfter');
      // retryAfter should be close to lockDuration (allow some tolerance)
      expect(jsonCall[0].retryAfter).toBeGreaterThan(0);
      expect(jsonCall[0].retryAfter).toBeLessThanOrEqual(lockDuration);
    });

    it('should attach agent to request on success', () => {
      mockReq.headers = { authorization: `Bearer ${apiKey}` };

      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq as AuthenticatedRequest).agent).toBeTruthy();
      expect((mockReq as AuthenticatedRequest).agent!.id).toBe('test@host');
      expect((mockReq as AuthenticatedRequest).agent!.department).toBe('engineering');
    });

    it('should attach agentId to request on success', () => {
      mockReq.headers = { authorization: `Bearer ${apiKey}` };

      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq as AuthenticatedRequest).agentId).toBe('test@host');
    });

    it('should call next() on success', () => {
      mockReq.headers = { authorization: `Bearer ${apiKey}` };

      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should not call next() on error', () => {
      mockReq.headers = { authorization: 'Bearer cm_invalidkey123456789012345' };

      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle malformed Bearer token gracefully', () => {
      mockReq.headers = { authorization: 'Bearer ' }; // Empty token after Bearer

      middleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('createOptionalAuthMiddleware', () => {
    let optionalMiddleware: ReturnType<typeof createOptionalAuthMiddleware>;

    beforeEach(() => {
      optionalMiddleware = createOptionalAuthMiddleware(agentService);
    });

    it('should call next() without auth header', () => {
      optionalMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should not attach agent without auth header', () => {
      optionalMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect((mockReq as AuthenticatedRequest).agent).toBeUndefined();
      expect((mockReq as AuthenticatedRequest).agentId).toBeUndefined();
    });

    it('should attach agent with valid auth', () => {
      mockReq.headers = { authorization: `Bearer ${apiKey}` };

      optionalMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq as AuthenticatedRequest).agent).toBeTruthy();
      expect((mockReq as AuthenticatedRequest).agentId).toBe('test@host');
    });

    it('should call next() even with invalid auth', () => {
      mockReq.headers = { authorization: 'Bearer cm_invalidkey123456789012345' };

      optionalMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq as AuthenticatedRequest).agent).toBeUndefined();
    });

    it('should call next() even with non-Bearer auth', () => {
      mockReq.headers = { authorization: 'Basic abc123' };

      optionalMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq as AuthenticatedRequest).agent).toBeUndefined();
    });

    it('should not attach unverified agent', () => {
      const unverified = agentService.registerAgent({
        id: 'unverified2@host',
        department: 'test',
      });

      mockReq.headers = { authorization: `Bearer ${unverified.apiKey}` };

      optionalMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      // Unverified agents should not be attached
      expect((mockReq as AuthenticatedRequest).agent).toBeUndefined();
    });

    it('should silently handle locked agent', () => {
      db.run(
        `
        UPDATE agents SET locked_until_epoch = ?
        WHERE id = 'test@host'
      `,
        [Math.floor(Date.now() / 1000) + 300]
      );

      mockReq.headers = { authorization: `Bearer ${apiKey}` };

      // Should not throw, just continue without agent
      optionalMiddleware(mockReq as AuthenticatedRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq as AuthenticatedRequest).agent).toBeUndefined();
    });
  });
});
