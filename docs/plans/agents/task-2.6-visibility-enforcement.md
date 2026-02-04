# Task 2.6: Enforce Visibility in Search and Context

<!-- HANDOFF FROM TASK 2.5 -->
## Context from Previous Agent

Task 2.5 is complete. Observations and session summaries now store agent metadata:

```typescript
// ObservationInput extended with optional agent metadata
storeObservation(db, memorySessionId, project, {
  type: 'discovery',
  title: 'Found bug',
  subtitle: 'In parser module',
  facts: ['Memory leak found', 'Caused by unclosed handle'],
  narrative: 'Details...',
  concepts: ['debugging', 'memory'],
  files_read: ['src/parser.ts'],
  files_modified: ['src/parser.ts'],
  // New fields:
  agent: 'seb@laptop',
  department: 'engineering',
  visibility: 'department'  // private | department | project | public
});

// SummaryInput also extended
storeSummary(db, memorySessionId, project, {
  request: 'Fix parser bug',
  investigated: 'Memory management code',
  learned: 'Handle cleanup required',
  completed: 'Fixed memory leak',
  next_steps: 'Add unit tests',
  notes: null,
  // New fields:
  agent: 'seb@laptop',
  department: 'engineering',
  visibility: 'department'
});
```

### Defaults if not provided:
- agent: 'legacy'
- department: 'default'
- visibility: 'project'

### Validation:
- Visibility must be one of: 'private', 'department', 'project', 'public'
- Invalid visibility throws an error

### Type exports:
```typescript
import { VisibilityLevel, VALID_VISIBILITIES } from './observations/types.js';
```

Your task is to enforce visibility rules when searching/reading observations.
Use SQL-level filtering for performance where possible.

Tests passing: `bun test tests/sqlite/observation-agent-metadata.test.ts` (11 tests)
<!-- END HANDOFF -->

**Phase:** 2 - Multi-Agent Architecture
**Issue:** #15
**Depends On:** Task 2.5 (observation metadata)
**Next Task:** `task-3.1-e2e-tests.md` (Phase 3)

---

## Objective

Enforce visibility rules when searching observations and retrieving context. Agents should only see observations they're authorized to access based on visibility level.

---

## Files to Modify

| File | Type |
|------|------|
| `src/services/sqlite/observations.ts` | Modify |
| `src/services/sqlite/session-summaries.ts` | Modify |
| `src/services/worker/http/routes/SearchRoutes.ts` | Modify |
| `tests/sqlite/visibility-enforcement.test.ts` | Create |
| `docs/plans/agents/specs/task-2.6.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-2.6.spec.md`:

```markdown
# Task 2.6 Specification: Visibility Enforcement

## Requirements

### Query Functions

#### searchObservations()
- [ ] Accepts optional agentId parameter
- [ ] If agentId provided, filters results by visibility
- [ ] If no agentId, returns all 'project' and 'public' (legacy behavior)
- [ ] Uses AgentService.canAccessObservation() for filtering

#### getObservationsForContext()
- [ ] Same visibility filtering as search
- [ ] Agent can always see their own observations

#### getSessionSummaries()
- [ ] Same visibility filtering

### Visibility Rules Recap
- `public`: Everyone can see
- `project`: Currently = public (no project ACLs yet)
- `department`: Same department only
- `private`: Owner only

### Performance Considerations
- [ ] Filter at SQL level when possible
- [ ] Post-filter only when necessary (department check)
- [ ] Limit results before expensive filtering

### Notes
```
IMPORTANT: visibility = 'project' currently means "visible to everyone".
If project-level ACLs are added in future, this filter must be updated
to check project membership.
```

## Test Cases

### visibility-enforcement.test.ts
- [ ] Agent sees own private observations
- [ ] Agent cannot see other's private observations
- [ ] Agent sees department observations (same dept)
- [ ] Agent cannot see department observations (different dept)
- [ ] Agent sees project/public observations
- [ ] Legacy mode (no agent) sees project/public only
```

---

## Step 2: Write Failing Tests

Create `tests/sqlite/visibility-enforcement.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/services/sqlite/migrations.js';
import { AgentService } from '../../src/services/agents/AgentService.js';
import { insertObservation, searchObservations } from '../../src/services/sqlite/observations.js';

describe('Visibility Enforcement', () => {
  let db: Database;
  let agentService: AgentService;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    agentService = new AgentService(db);

    // Create test agents
    agentService.registerAgent({ id: 'alice@host', department: 'engineering' });
    agentService.registerAgent({ id: 'bob@host', department: 'engineering' });
    agentService.registerAgent({ id: 'carol@host', department: 'marketing' });

    // Create test observations with different visibility
    insertObservation(db, {
      project: 'github.com/test/repo',
      session_id: 'session-1',
      type: 'discovery',
      title: 'Private to Alice',
      narrative: 'Only Alice can see this',
      concepts: ['test'],
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
      title: 'Engineering Dept',
      narrative: 'Engineering team can see this',
      concepts: ['test'],
      files: [],
      tools: [],
      agent: 'alice@host',
      department: 'engineering',
      visibility: 'department'
    });

    insertObservation(db, {
      project: 'github.com/test/repo',
      session_id: 'session-1',
      type: 'discovery',
      title: 'Project Wide',
      narrative: 'Everyone in project can see',
      concepts: ['test'],
      files: [],
      tools: [],
      agent: 'alice@host',
      department: 'engineering',
      visibility: 'project'
    });

    insertObservation(db, {
      project: 'github.com/test/repo',
      session_id: 'session-1',
      type: 'discovery',
      title: 'Public Info',
      narrative: 'Everyone can see this',
      concepts: ['test'],
      files: [],
      tools: [],
      agent: 'alice@host',
      department: 'engineering',
      visibility: 'public'
    });
  });

  afterEach(() => {
    db.close();
  });

  describe('Alice (engineering, owner)', () => {
    it('should see all observations including private', () => {
      const results = searchObservations(db, {
        project: 'github.com/test/repo',
        agentId: 'alice@host',
        agentService
      });

      const titles = results.map(r => r.title);
      expect(titles).toContain('Private to Alice');
      expect(titles).toContain('Engineering Dept');
      expect(titles).toContain('Project Wide');
      expect(titles).toContain('Public Info');
    });
  });

  describe('Bob (engineering, not owner)', () => {
    it('should see department and project/public, not private', () => {
      const results = searchObservations(db, {
        project: 'github.com/test/repo',
        agentId: 'bob@host',
        agentService
      });

      const titles = results.map(r => r.title);
      expect(titles).not.toContain('Private to Alice');
      expect(titles).toContain('Engineering Dept');
      expect(titles).toContain('Project Wide');
      expect(titles).toContain('Public Info');
    });
  });

  describe('Carol (marketing)', () => {
    it('should see only project/public, not department or private', () => {
      const results = searchObservations(db, {
        project: 'github.com/test/repo',
        agentId: 'carol@host',
        agentService
      });

      const titles = results.map(r => r.title);
      expect(titles).not.toContain('Private to Alice');
      expect(titles).not.toContain('Engineering Dept');
      expect(titles).toContain('Project Wide');
      expect(titles).toContain('Public Info');
    });
  });

  describe('Legacy mode (no agent)', () => {
    it('should see project and public only', () => {
      const results = searchObservations(db, {
        project: 'github.com/test/repo'
        // No agentId - legacy mode
      });

      const titles = results.map(r => r.title);
      expect(titles).not.toContain('Private to Alice');
      expect(titles).not.toContain('Engineering Dept');
      expect(titles).toContain('Project Wide');
      expect(titles).toContain('Public Info');
    });
  });
});
```

---

## Step 3: Update Implementation

Modify `src/services/sqlite/observations.ts`:

```typescript
import { AgentService } from '../agents/AgentService.js';
import { getProjectsWithAliases } from './project-aliases.js';

export interface SearchOptions {
  project: string;
  query?: string;
  limit?: number;
  agentId?: string;
  agentService?: AgentService;
}

export function searchObservations(db: Database, options: SearchOptions): any[] {
  const { project, query, limit = 50, agentId, agentService } = options;

  // Expand project to include aliases
  const projects = getProjectsWithAliases(db, project);
  const placeholders = projects.map(() => '?').join(', ');

  // Build base query
  let sql = `
    SELECT * FROM observations
    WHERE project IN (${placeholders})
  `;
  const params: any[] = [...projects];

  // Add text search if query provided
  if (query) {
    sql += ` AND (title LIKE ? OR narrative LIKE ?)`;
    params.push(`%${query}%`, `%${query}%`);
  }

  // Add visibility filter
  if (agentId && agentService) {
    const agent = agentService.getAgent(agentId);
    if (agent) {
      // SQL-level filtering for performance
      sql += ` AND (
        visibility IN ('public', 'project')
        OR (visibility = 'department' AND department = ?)
        OR (visibility = 'private' AND agent = ?)
      )`;
      params.push(agent.department, agentId);
    } else {
      // Unknown agent - public/project only
      sql += ` AND visibility IN ('public', 'project')`;
    }
  } else {
    // Legacy mode - public/project only
    // IMPORTANT: visibility = 'project' currently means "visible to everyone".
    // If project-level ACLs are added, update this filter.
    sql += ` AND visibility IN ('public', 'project')`;
  }

  sql += ` ORDER BY created_at_epoch DESC LIMIT ?`;
  params.push(limit);

  const rows = db.query(sql).all(...params) as any[];

  return rows.map(row => ({
    ...row,
    concepts: JSON.parse(row.concepts_json || '[]'),
    files: JSON.parse(row.files_json || '[]'),
    tools: JSON.parse(row.tools_json || '[]')
  }));
}

export function getObservationsForContext(
  db: Database,
  options: SearchOptions & { fullCount?: number }
): any[] {
  // Use same visibility logic as search
  return searchObservations(db, options);
}
```

Apply similar changes to session summary queries.

---

## Step 4: Update API Routes

Modify search routes to pass agent context:

```typescript
// In SearchRoutes.ts or MCP handlers
const results = searchObservations(db, {
  project,
  query,
  agentId: req.agentId,  // From auth middleware
  agentService: this.agentService
});
```

---

## Step 5: Run Tests

```bash
bun test tests/sqlite/visibility-enforcement.test.ts
```

---

## Step 6: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-2.6.spec.md`.

---

## Step 7: Commit

```bash
git add src/services/sqlite/observations.ts \
        src/services/sqlite/session-summaries.ts \
        src/services/worker/http/routes/SearchRoutes.ts \
        tests/sqlite/visibility-enforcement.test.ts \
        docs/plans/agents/specs/task-2.6.spec.md
git commit -m "feat: enforce visibility rules in observation search and context

- searchObservations() filters by agent visibility
- SQL-level filtering for performance (public, project, department)
- Private observations visible only to owner
- Legacy mode sees project/public only
- Note: project visibility = global until project ACLs added

Part of #15"
```

---

## Phase 2 Complete!

This concludes Phase 2 (Multi-Agent Architecture).

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-3.1-e2e-tests.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 2.6 -->
## Phase 2 Complete!

All Phase 2 tasks (2.1-2.6) are complete. Multi-agent architecture is now functional:

### Summary of Phase 2 Changes

1. **Agents Table** (migration 009)
   - O(1) key lookup via api_key_prefix index
   - Brute-force protection (5 attempts → 5 min lockout)
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

5. **Observation Metadata**
   - agent, department, visibility columns
   - Defaults for backwards compatibility

6. **Visibility Enforcement**
   - SQL-level filtering in search
   - private, department, project, public levels

### Ready for Phase 3

Phase 3 adds E2E tests, settings integration, and documentation.

Tests passing: All Phase 2 tests
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All tests pass
- [ ] SQL-level visibility filtering
- [ ] Backwards compatible
- [ ] Code committed
- [ ] Handoff comment added to task-3.1
