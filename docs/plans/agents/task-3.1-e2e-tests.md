# Task 3.1: End-to-End Integration Tests

<!-- HANDOFF FROM TASK 2.6 -->
## Phase 2 Complete!

All Phase 2 tasks (2.1-2.6) are complete. Multi-agent architecture is now functional:

### Summary of Phase 2 Changes

1. **Agents Table** (migration 021)
   - O(1) key lookup via api_key_prefix index
   - Brute-force protection (5 attempts -> 5 min lockout)
   - 90-day key expiration

2. **AgentService** (`src/services/agents/AgentService.ts`)
   - registerAgent(), findAgentByKey(), verifyAgent()
   - rotateApiKey(), revokeApiKey()
   - canAccessObservation() for visibility checks

3. **Auth Middleware**
   - O(1) lookup with proper error handling
   - Rate limiting on auth endpoints

4. **Agent API Endpoints**
   - /api/agents/register, /verify, /rotate-key, /revoke, /me

5. **Observation Metadata** (Task 2.5)
   - agent, department, visibility columns
   - Defaults for backwards compatibility (agent='legacy', department='default', visibility='project')

6. **Visibility Enforcement** (Task 2.6)
   - SQL-level filtering in SessionSearch methods
   - buildVisibilityClause() for efficient access control
   - private, department, project, public levels
   - Legacy mode (no agent) sees project/public only

### Key Files Modified in Task 2.6
- `src/services/sqlite/SessionSearch.ts` - Added visibility filtering to all search methods
- `src/services/sqlite/types.ts` - Added VisibilityFilterOptions interface
- `tests/sqlite/visibility-enforcement.test.ts` - 5 tests for visibility rules
- `docs/plans/agents/specs/task-2.6.spec.md` - Specification

### Ready for Phase 3

Phase 3 adds E2E tests, settings integration, and documentation.

Tests passing: All Phase 2 tests (122 tests across 11 files)
<!-- END HANDOFF -->

**Phase:** 3 - Integration & Testing
**Issue:** #14, #15
**Depends On:** Phase 2 complete (task-2.6)
**Next Task:** `task-3.2-settings-integration.md`

---

## Objective

Create comprehensive end-to-end tests that verify the full workflow of both features: git-based project identification and multi-agent visibility.

---

## Files to Create

| File | Type |
|------|------|
| `tests/e2e/project-identity.e2e.test.ts` | E2E Tests |
| `tests/e2e/multi-agent.e2e.test.ts` | E2E Tests |
| `docs/plans/agents/specs/task-3.1.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-3.1.spec.md`:

```markdown
# Task 3.1 Specification: E2E Integration Tests

## Project Identity E2E Tests

### Git Remote Detection
- [ ] Detects git remote for real repository
- [ ] Falls back to basename for non-git directory
- [ ] Falls back to basename for repo without remote

### Alias Registration
- [ ] Registers alias on session start
- [ ] Alias persists across sessions
- [ ] Old observations accessible via new project ID

### Query with Aliases
- [ ] Search returns data from both old and new project IDs
- [ ] Context includes aliased observations

## Multi-Agent E2E Tests

### Agent Lifecycle
- [ ] Register → Verify → Use → Rotate → Revoke
- [ ] Key expiration after 90 days (mocked)
- [ ] Brute-force lockout after 5 failures

### Visibility Workflow
- [ ] Agent creates private observation
- [ ] Same agent can read it
- [ ] Different agent cannot read it
- [ ] Same-department agent can read department observation

### API Integration
- [ ] Full register/verify flow via HTTP
- [ ] Protected endpoints require valid token
- [ ] Rate limiting works

## Combined Tests

### Cross-Feature Integration
- [ ] Agent creates observation with git remote project ID
- [ ] Observation accessible via alias
- [ ] Visibility enforced correctly
```

---

## Step 2: Write E2E Tests

Create `tests/e2e/project-identity.e2e.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { runMigrations } from '../../src/services/sqlite/migrations.js';
import { getProjectName } from '../../src/utils/project-name.js';
import { registerSessionAlias } from '../../src/hooks/session-alias.js';
import {
  insertObservation,
  searchObservations
} from '../../src/services/sqlite/observations.js';
import { getProjectsWithAliases } from '../../src/services/sqlite/project-aliases.js';

describe('Project Identity E2E', () => {
  let db: Database;
  const testDir = '/tmp/claude-mem-e2e-test';
  const repoDir = path.join(testDir, 'test-repo');

  beforeAll(() => {
    // Setup test database
    db = new Database(':memory:');
    runMigrations(db);

    // Create test directory structure
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(repoDir, { recursive: true });

    // Initialize git repo with remote
    execSync('git init', { cwd: repoDir, stdio: 'pipe' });
    execSync('git remote add origin https://github.com/test/e2e-repo.git', {
      cwd: repoDir,
      stdio: 'pipe'
    });
  });

  afterAll(() => {
    db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Git Remote Detection', () => {
    it('should detect git remote for repository', () => {
      const projectName = getProjectName(repoDir);
      expect(projectName).toBe('github.com/test/e2e-repo');
    });

    it('should fall back to basename for non-git directory', () => {
      const projectName = getProjectName(testDir);
      expect(projectName).toBe('claude-mem-e2e-test');
    });
  });

  describe('Alias Registration and Query', () => {
    it('should register alias and query across both project IDs', () => {
      const oldProject = 'e2e-repo';
      const newProject = 'github.com/test/e2e-repo';

      // Insert observation with old project name (simulating historical data)
      insertObservation(db, {
        project: oldProject,
        session_id: 'old-session',
        type: 'discovery',
        title: 'Old Observation',
        narrative: 'Created before git remote ID',
        concepts: ['legacy'],
        files: [],
        tools: []
      });

      // Register alias (simulating session start)
      registerSessionAlias(db, repoDir);

      // Insert observation with new project name
      insertObservation(db, {
        project: newProject,
        session_id: 'new-session',
        type: 'feature',
        title: 'New Observation',
        narrative: 'Created with git remote ID',
        concepts: ['modern'],
        files: [],
        tools: []
      });

      // Verify alias was registered
      const aliases = getProjectsWithAliases(db, newProject);
      expect(aliases).toContain(newProject);
      expect(aliases).toContain(oldProject);

      // Search with new project ID should find both
      const results = searchObservations(db, {
        project: newProject
      });

      const titles = results.map(r => r.title);
      expect(titles).toContain('Old Observation');
      expect(titles).toContain('New Observation');
    });
  });
});
```

Create `tests/e2e/multi-agent.e2e.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import express from 'express';
import request from 'supertest';
import { runMigrations } from '../../src/services/sqlite/migrations.js';
import { AgentService } from '../../src/services/agents/AgentService.js';
import { AgentRoutes } from '../../src/services/worker/http/routes/AgentRoutes.js';
import {
  insertObservation,
  searchObservations
} from '../../src/services/sqlite/observations.js';

describe('Multi-Agent E2E', () => {
  let db: Database;
  let app: express.Express;
  let agentService: AgentService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    agentService = new AgentService(db);

    app = express();
    app.use(express.json());

    const agentRoutes = new AgentRoutes(db, agentService);
    agentRoutes.register(app);
  });

  afterEach(() => {
    db.close();
  });

  describe('Full Agent Lifecycle', () => {
    it('should support register → verify → use → rotate → revoke', async () => {
      // 1. Register
      const regRes = await request(app)
        .post('/api/agents/register')
        .send({ id: 'lifecycle@test', department: 'engineering' });

      expect(regRes.status).toBe(200);
      expect(regRes.body.apiKey).toMatch(/^cm_/);
      const apiKey = regRes.body.apiKey;

      // 2. Verify
      const verifyRes = await request(app)
        .post('/api/agents/verify')
        .send({ id: 'lifecycle@test', apiKey });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.agent.verified).toBe(true);

      // 3. Use (get self info)
      const meRes = await request(app)
        .get('/api/agents/me')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.agent.id).toBe('lifecycle@test');

      // 4. Rotate key
      const rotateRes = await request(app)
        .post('/api/agents/rotate-key')
        .set('Authorization', `Bearer ${apiKey}`);

      expect(rotateRes.status).toBe(200);
      const newApiKey = rotateRes.body.apiKey;
      expect(newApiKey).not.toBe(apiKey);

      // Old key no longer works
      const oldKeyRes = await request(app)
        .get('/api/agents/me')
        .set('Authorization', `Bearer ${apiKey}`);
      expect(oldKeyRes.status).toBe(401);

      // New key works (after re-verification)
      await request(app)
        .post('/api/agents/verify')
        .send({ id: 'lifecycle@test', apiKey: newApiKey });

      // 5. Revoke
      const revokeRes = await request(app)
        .post('/api/agents/revoke')
        .set('Authorization', `Bearer ${newApiKey}`);

      expect(revokeRes.status).toBe(200);

      // Key no longer works
      const revokedRes = await request(app)
        .get('/api/agents/me')
        .set('Authorization', `Bearer ${newApiKey}`);
      expect(revokedRes.status).toBe(401);
    });
  });

  describe('Visibility Workflow', () => {
    let aliceKey: string;
    let bobKey: string;
    let carolKey: string;

    beforeEach(async () => {
      // Setup three agents
      const agents = [
        { id: 'alice@host', department: 'engineering' },
        { id: 'bob@host', department: 'engineering' },
        { id: 'carol@host', department: 'marketing' }
      ];

      for (const agent of agents) {
        const res = await request(app)
          .post('/api/agents/register')
          .send(agent);
        const key = res.body.apiKey;

        await request(app)
          .post('/api/agents/verify')
          .send({ id: agent.id, apiKey: key });

        if (agent.id === 'alice@host') aliceKey = key;
        if (agent.id === 'bob@host') bobKey = key;
        if (agent.id === 'carol@host') carolKey = key;
      }

      // Create observations with different visibility
      insertObservation(db, {
        project: 'github.com/test/repo',
        session_id: 'session-1',
        type: 'discovery',
        title: 'Private Note',
        narrative: 'Only Alice can see',
        concepts: [],
        files: [],
        tools: [],
        agent: 'alice@host',
        department: 'engineering',
        visibility: 'private'
      });

      insertObservation(db, {
        project: 'github.com/test/repo',
        session_id: 'session-1',
        type: 'discovery',
        title: 'Team Note',
        narrative: 'Engineering team can see',
        concepts: [],
        files: [],
        tools: [],
        agent: 'alice@host',
        department: 'engineering',
        visibility: 'department'
      });
    });

    it('should enforce private visibility', () => {
      // Alice can see her private note
      const aliceResults = searchObservations(db, {
        project: 'github.com/test/repo',
        agentId: 'alice@host',
        agentService
      });
      expect(aliceResults.map(r => r.title)).toContain('Private Note');

      // Bob cannot see Alice's private note
      const bobResults = searchObservations(db, {
        project: 'github.com/test/repo',
        agentId: 'bob@host',
        agentService
      });
      expect(bobResults.map(r => r.title)).not.toContain('Private Note');
    });

    it('should enforce department visibility', () => {
      // Bob (engineering) can see team note
      const bobResults = searchObservations(db, {
        project: 'github.com/test/repo',
        agentId: 'bob@host',
        agentService
      });
      expect(bobResults.map(r => r.title)).toContain('Team Note');

      // Carol (marketing) cannot see engineering team note
      const carolResults = searchObservations(db, {
        project: 'github.com/test/repo',
        agentId: 'carol@host',
        agentService
      });
      expect(carolResults.map(r => r.title)).not.toContain('Team Note');
    });
  });
});
```

---

## Step 3: Run Tests

```bash
bun test tests/e2e/
```

---

## Step 4: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-3.1.spec.md`.

---

## Step 5: Commit

```bash
git add tests/e2e/project-identity.e2e.test.ts \
        tests/e2e/multi-agent.e2e.test.ts \
        docs/plans/agents/specs/task-3.1.spec.md
git commit -m "test: add E2E integration tests for project identity and multi-agent

- Project identity: git remote detection, alias registration, cross-ID queries
- Multi-agent: full lifecycle, visibility enforcement
- Combined cross-feature integration tests

Part of #14, #15"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-3.2-settings-integration.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 3.1 -->
## Context from Previous Agent

Task 3.1 is complete. E2E tests are now in place:

### Test Coverage
- `tests/e2e/project-identity.e2e.test.ts`
  - Git remote detection
  - Alias registration
  - Cross-ID queries

- `tests/e2e/multi-agent.e2e.test.ts`
  - Full agent lifecycle
  - Visibility enforcement
  - API integration

All E2E tests passing.

Your task is to add settings for the new features:
- Git remote preference order
- Default visibility level
- Agent key expiry days

Tests passing: `bun test tests/e2e/`
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All E2E tests pass
- [ ] Tests cover both features
- [ ] Tests cover cross-feature integration
- [ ] Code committed
- [ ] Handoff comment added to task-3.2
