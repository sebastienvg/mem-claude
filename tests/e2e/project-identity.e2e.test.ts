/**
 * Project Identity E2E Tests (Task 3.1)
 *
 * Tests the full workflow of git-based project identification:
 * - Git remote detection
 * - Project alias registration
 * - Cross-project ID queries
 *
 * Part of Phase 3: Integration & Testing (#14, #15)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { getProjectName } from '../../src/utils/project-name.js';
import { registerSessionAlias } from '../../src/hooks/session-alias.js';
import {
  storeObservation,
} from '../../src/services/sqlite/Observations.js';
import {
  createSDKSession,
  updateMemorySessionId,
} from '../../src/services/sqlite/Sessions.js';
import {
  registerProjectAlias,
  getProjectsWithAliases,
} from '../../src/services/sqlite/project-aliases.js';
import type { ObservationInput } from '../../src/services/sqlite/observations/types.js';
import type { Database } from 'bun:sqlite';

describe('Project Identity E2E', () => {
  const testDir = '/tmp/claude-mem-e2e-project-test';
  const repoDir = path.join(testDir, 'test-repo');
  const nonGitDir = path.join(testDir, 'non-git-folder');

  beforeAll(() => {
    // Create test directory structure
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(nonGitDir, { recursive: true });

    // Initialize git repo with remote
    execSync('git init', { cwd: repoDir, stdio: 'pipe' });
    execSync('git remote add origin https://github.com/test-org/e2e-test-repo.git', {
      cwd: repoDir,
      stdio: 'pipe',
    });
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Git Remote Detection', () => {
    it('should detect git remote for repository', () => {
      const projectName = getProjectName(repoDir);
      expect(projectName).toBe('github.com/test-org/e2e-test-repo');
    });

    it('should fall back to basename for non-git directory', () => {
      const projectName = getProjectName(nonGitDir);
      expect(projectName).toBe('non-git-folder');
    });

    it('should fall back to basename for repo without remote', () => {
      const noRemoteDir = path.join(testDir, 'no-remote-repo');
      mkdirSync(noRemoteDir, { recursive: true });
      execSync('git init', { cwd: noRemoteDir, stdio: 'pipe' });

      const projectName = getProjectName(noRemoteDir);
      expect(projectName).toBe('no-remote-repo');

      rmSync(noRemoteDir, { recursive: true });
    });
  });

  describe('Alias Registration', () => {
    let db: Database;

    beforeEach(() => {
      const claudeMemDb = new ClaudeMemDatabase(':memory:');
      db = claudeMemDb.db;
    });

    afterEach(() => {
      db.close();
    });

    it('should register alias when project ID differs from basename', () => {
      const projectId = 'github.com/test-org/e2e-test-repo';
      const basename = 'e2e-test-repo';

      // Manually register alias (simulating what registerSessionAlias does)
      const wasNew = registerProjectAlias(db, basename, projectId);
      expect(wasNew).toBe(true);

      // Verify alias was registered
      const aliases = getProjectsWithAliases(db, projectId);
      expect(aliases).toContain(projectId);
      expect(aliases).toContain(basename);
    });

    it('should use registerSessionAlias for automatic registration', () => {
      const projectId = 'github.com/test-org/e2e-test-repo';

      // registerSessionAlias uses getProjectName internally
      // We simulate by calling it with the detected project ID
      registerSessionAlias(db, repoDir, projectId);

      // Verify alias was registered (basename = 'test-repo')
      const aliases = getProjectsWithAliases(db, projectId);
      expect(aliases).toContain(projectId);
      expect(aliases).toContain('test-repo');
    });

    it('should not register alias when project ID equals basename', () => {
      const projectId = 'my-project';

      // When projectId doesn't contain '/', registerSessionAlias skips registration
      registerSessionAlias(db, '/some/path/my-project', projectId);

      // No alias should be registered
      const aliases = getProjectsWithAliases(db, projectId);
      expect(aliases).toHaveLength(1);
      expect(aliases[0]).toBe(projectId);
    });
  });

  describe('Query with Aliases', () => {
    let db: Database;

    beforeEach(() => {
      const claudeMemDb = new ClaudeMemDatabase(':memory:');
      db = claudeMemDb.db;
    });

    afterEach(() => {
      db.close();
    });

    /**
     * Helper to create a valid observation input
     */
    function createObservationInput(overrides: Partial<ObservationInput> = {}): ObservationInput {
      return {
        type: 'discovery',
        title: 'Test Observation',
        subtitle: 'Test Subtitle',
        facts: ['fact1', 'fact2'],
        narrative: 'Test narrative content',
        concepts: ['test'],
        files_read: ['/path/to/file1.ts'],
        files_modified: ['/path/to/file2.ts'],
        ...overrides,
      };
    }

    /**
     * Helper to create a session and return memory_session_id
     */
    function createSessionWithMemoryId(
      contentSessionId: string,
      memorySessionId: string,
      project: string = 'test-project'
    ): string {
      const sessionId = createSDKSession(db, contentSessionId, project, 'initial prompt');
      updateMemorySessionId(db, sessionId, memorySessionId);
      return memorySessionId;
    }

    it('should return data from both old and new project IDs', () => {
      const oldProject = 'e2e-test-repo';
      const newProject = 'github.com/test-org/e2e-test-repo';

      // Insert observation with old project name (simulating historical data)
      const oldMemSessionId = createSessionWithMemoryId('old-content', 'old-mem-session', oldProject);
      storeObservation(db, oldMemSessionId, oldProject, createObservationInput({
        title: 'Old Observation',
        narrative: 'Created before git remote ID',
      }));

      // Register alias
      registerProjectAlias(db, oldProject, newProject);

      // Insert observation with new project name
      const newMemSessionId = createSessionWithMemoryId('new-content', 'new-mem-session', newProject);
      storeObservation(db, newMemSessionId, newProject, createObservationInput({
        title: 'New Observation',
        narrative: 'Created with git remote ID',
      }));

      // Query using alias resolution - getProjectsWithAliases expands to both project names
      const allProjects = getProjectsWithAliases(db, newProject);
      const placeholders = allProjects.map(() => '?').join(', ');

      const results = db.query(`
        SELECT title FROM observations WHERE project IN (${placeholders})
      `).all(...allProjects) as { title: string }[];

      const titles = results.map(r => r.title);
      expect(titles).toContain('Old Observation');
      expect(titles).toContain('New Observation');
    });

    it('should include aliased observations in context', () => {
      const oldProject = 'legacy-name';
      const newProject = 'github.com/user/legacy-name';

      // Create historical data
      const memSessionId1 = createSessionWithMemoryId('content1', 'mem-session-1', oldProject);
      storeObservation(db, memSessionId1, oldProject, createObservationInput({
        title: 'Legacy Feature',
        narrative: 'Important feature documented under old name',
        concepts: ['authentication', 'security'],
      }));

      // Register alias
      registerProjectAlias(db, oldProject, newProject);

      // Verify we can query all related projects
      const projects = getProjectsWithAliases(db, newProject);
      expect(projects).toContain(newProject);
      expect(projects).toContain(oldProject);
      expect(projects).toHaveLength(2);

      // Verify the observation is accessible
      const observations = db.query(`
        SELECT * FROM observations WHERE project IN (?, ?)
      `).all(newProject, oldProject) as any[];

      expect(observations).toHaveLength(1);
      expect(observations[0].title).toBe('Legacy Feature');
    });
  });

  describe('Full Integration Flow', () => {
    let db: Database;

    beforeEach(() => {
      const claudeMemDb = new ClaudeMemDatabase(':memory:');
      db = claudeMemDb.db;
    });

    afterEach(() => {
      db.close();
    });

    it('should handle complete session workflow with alias registration', () => {
      // Simulate a session starting in a git repo
      const projectId = getProjectName(repoDir); // 'github.com/test-org/e2e-test-repo'
      expect(projectId).toBe('github.com/test-org/e2e-test-repo');

      // Register the session alias
      registerSessionAlias(db, repoDir, projectId);

      // Create a session
      const contentSessionId = 'full-flow-content-session';
      const memorySessionId = 'full-flow-mem-session';
      const sessionDbId = createSDKSession(db, contentSessionId, projectId, 'Test prompt');
      updateMemorySessionId(db, sessionDbId, memorySessionId);

      // Store an observation
      storeObservation(db, memorySessionId, projectId, {
        type: 'feature',
        title: 'New Feature Implementation',
        subtitle: 'Added user authentication',
        facts: ['Implemented JWT tokens', 'Added refresh token support'],
        narrative: 'Complete authentication system',
        concepts: ['authentication', 'jwt', 'security'],
        files_read: ['/src/auth/index.ts'],
        files_modified: ['/src/auth/jwt.ts', '/src/auth/refresh.ts'],
      });

      // Verify alias was registered
      const aliases = getProjectsWithAliases(db, projectId);
      expect(aliases).toContain(projectId);
      expect(aliases).toContain('test-repo'); // basename

      // Verify observation can be queried via both identifiers
      const allProjects = aliases;
      const placeholders = allProjects.map(() => '?').join(', ');
      const results = db.query(`
        SELECT * FROM observations WHERE project IN (${placeholders})
      `).all(...allProjects) as any[];

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('New Feature Implementation');
    });
  });
});
