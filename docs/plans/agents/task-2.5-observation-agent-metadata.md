# Task 2.5: Update Observation Insertion with Agent Metadata

<!-- HANDOFF FROM TASK 2.4 -->
## Context from Previous Agent

Task 2.4 is complete. Agent API endpoints are now available:

### Public Endpoints (rate limited)
- `POST /api/agents/register` - Register or update agent
- `POST /api/agents/verify` - Verify with API key

### Protected Endpoints (require auth)
- `POST /api/agents/rotate-key` - Get new API key
- `POST /api/agents/revoke` - Revoke current key
- `GET /api/agents/me` - Get own info

### Integration
```typescript
import { AgentRoutes } from './http/routes/AgentRoutes.js';
import { AgentService } from '../../agents/AgentService.js';

const agentService = new AgentService(db);
const agentRoutes = new AgentRoutes(db, agentService);
agentRoutes.register(app);
```

### Response Format
```typescript
// Registration (new agent)
{ success: true, agent: {...}, apiKey: "cm_..." }

// Registration (existing agent)
{ success: true, agent: {...} }

// Errors
{ error: "ERROR_CODE", message: "Human readable message" }
```

Your task is to update observation insertion to include agent metadata
(agent ID, department, visibility) when creating new observations.

Tests passing: `bun test tests/routes/agent-routes.test.ts` (21 tests)
<!-- END HANDOFF -->

**Phase:** 2 - Multi-Agent Architecture
**Issue:** #15
**Depends On:** Task 2.4 (agent endpoints)
**Next Task:** `task-2.6-visibility-enforcement.md`

---

## Objective

Update observation and session summary insertion to include agent metadata (agent ID, department, visibility level).

---

## Files to Modify

| File | Type |
|------|------|
| `src/services/sqlite/observations.ts` | Modify |
| `src/services/sqlite/session-summaries.ts` | Modify |
| `tests/sqlite/observation-agent-metadata.test.ts` | Create |
| `docs/plans/agents/specs/task-2.5.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-2.5.spec.md`:

```markdown
# Task 2.5 Specification: Observation Agent Metadata

## Requirements

### insertObservation()
- [ ] Accepts optional agent, department, visibility parameters
- [ ] Defaults: agent='legacy', department='default', visibility='project'
- [ ] Validates visibility is one of: private, department, project, public
- [ ] Stores metadata in observation record

### insertSessionSummary()
- [ ] Accepts optional agent, department, visibility parameters
- [ ] Same defaults as observations
- [ ] Stores metadata in session summary record

### Visibility Levels
- [ ] `private`: Only the creating agent can see
- [ ] `department`: All agents in same department can see
- [ ] `project`: All agents with project access can see
- [ ] `public`: All agents can see

### Backwards Compatibility
- [ ] Existing code without metadata works (uses defaults)
- [ ] Existing data has 'legacy' agent and 'project' visibility

## Test Cases

### observation-agent-metadata.test.ts
- [ ] Inserts observation with all metadata
- [ ] Inserts observation with defaults
- [ ] Rejects invalid visibility value
- [ ] Session summary with metadata
- [ ] Session summary with defaults
```

---

## Step 2: Write Failing Tests

Create `tests/sqlite/observation-agent-metadata.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { runMigrations } from '../../src/services/sqlite/migrations.js';
import {
  insertObservation,
  getObservation
} from '../../src/services/sqlite/observations.js';
import {
  insertSessionSummary,
  getSessionSummary
} from '../../src/services/sqlite/session-summaries.js';

describe('Observation Agent Metadata', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('insertObservation', () => {
    it('should insert observation with all metadata', () => {
      const id = insertObservation(db, {
        project: 'test-project',
        session_id: 'session-1',
        type: 'discovery',
        title: 'Test Observation',
        narrative: 'Test narrative',
        concepts: ['test'],
        files: [],
        tools: [],
        agent: 'seb@laptop',
        department: 'engineering',
        visibility: 'department'
      });

      const obs = getObservation(db, id);

      expect(obs.agent).toBe('seb@laptop');
      expect(obs.department).toBe('engineering');
      expect(obs.visibility).toBe('department');
    });

    it('should use defaults when metadata not provided', () => {
      const id = insertObservation(db, {
        project: 'test-project',
        session_id: 'session-1',
        type: 'discovery',
        title: 'Test Observation',
        narrative: 'Test narrative',
        concepts: ['test'],
        files: [],
        tools: []
        // No agent, department, visibility
      });

      const obs = getObservation(db, id);

      expect(obs.agent).toBe('legacy');
      expect(obs.department).toBe('default');
      expect(obs.visibility).toBe('project');
    });

    it('should reject invalid visibility value', () => {
      expect(() => {
        insertObservation(db, {
          project: 'test-project',
          session_id: 'session-1',
          type: 'discovery',
          title: 'Test',
          narrative: 'Test',
          concepts: [],
          files: [],
          tools: [],
          visibility: 'invalid' as any
        });
      }).toThrow();
    });

    it('should allow all valid visibility values', () => {
      const visibilities = ['private', 'department', 'project', 'public'] as const;

      for (const visibility of visibilities) {
        const id = insertObservation(db, {
          project: 'test-project',
          session_id: `session-${visibility}`,
          type: 'discovery',
          title: `Test ${visibility}`,
          narrative: 'Test',
          concepts: [],
          files: [],
          tools: [],
          visibility
        });

        const obs = getObservation(db, id);
        expect(obs.visibility).toBe(visibility);
      }
    });
  });

  describe('insertSessionSummary', () => {
    it('should insert session summary with metadata', () => {
      const id = insertSessionSummary(db, {
        session_id: 'session-1',
        project: 'test-project',
        summary: 'Test summary',
        agent: 'seb@laptop',
        department: 'engineering',
        visibility: 'private'
      });

      const summary = getSessionSummary(db, id);

      expect(summary.agent).toBe('seb@laptop');
      expect(summary.department).toBe('engineering');
      expect(summary.visibility).toBe('private');
    });

    it('should use defaults when metadata not provided', () => {
      const id = insertSessionSummary(db, {
        session_id: 'session-1',
        project: 'test-project',
        summary: 'Test summary'
      });

      const summary = getSessionSummary(db, id);

      expect(summary.agent).toBe('legacy');
      expect(summary.department).toBe('default');
      expect(summary.visibility).toBe('project');
    });
  });
});
```

---

## Step 3: Update Implementation

Modify `src/services/sqlite/observations.ts`:

```typescript
// Add to existing types
export interface ObservationInput {
  project: string;
  session_id: string;
  type: string;
  title: string;
  narrative: string;
  concepts: string[];
  files: string[];
  tools: string[];
  // New optional fields
  agent?: string;
  department?: string;
  visibility?: 'private' | 'department' | 'project' | 'public';
}

const VALID_VISIBILITIES = ['private', 'department', 'project', 'public'];

export function insertObservation(db: Database, input: ObservationInput): number {
  // Validate visibility if provided
  if (input.visibility && !VALID_VISIBILITIES.includes(input.visibility)) {
    throw new Error(`Invalid visibility: ${input.visibility}. Must be one of: ${VALID_VISIBILITIES.join(', ')}`);
  }

  const agent = input.agent ?? 'legacy';
  const department = input.department ?? 'default';
  const visibility = input.visibility ?? 'project';

  const result = db.run(`
    INSERT INTO observations (
      project, session_id, type, title, narrative,
      concepts_json, files_json, tools_json,
      agent, department, visibility
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.project,
    input.session_id,
    input.type,
    input.title,
    input.narrative,
    JSON.stringify(input.concepts),
    JSON.stringify(input.files),
    JSON.stringify(input.tools),
    agent,
    department,
    visibility
  ]);

  return result.lastInsertRowid as number;
}

export function getObservation(db: Database, id: number): any {
  const row = db.query('SELECT * FROM observations WHERE id = ?').get(id) as any;
  if (!row) return null;

  return {
    ...row,
    concepts: JSON.parse(row.concepts_json || '[]'),
    files: JSON.parse(row.files_json || '[]'),
    tools: JSON.parse(row.tools_json || '[]')
  };
}
```

Apply similar changes to `src/services/sqlite/session-summaries.ts`:

```typescript
export interface SessionSummaryInput {
  session_id: string;
  project: string;
  summary: string;
  // New optional fields
  agent?: string;
  department?: string;
  visibility?: 'private' | 'department' | 'project' | 'public';
}

export function insertSessionSummary(db: Database, input: SessionSummaryInput): number {
  const agent = input.agent ?? 'legacy';
  const department = input.department ?? 'default';
  const visibility = input.visibility ?? 'project';

  const result = db.run(`
    INSERT INTO session_summaries (
      session_id, project, summary, agent, department, visibility
    ) VALUES (?, ?, ?, ?, ?, ?)
  `, [
    input.session_id,
    input.project,
    input.summary,
    agent,
    department,
    visibility
  ]);

  return result.lastInsertRowid as number;
}

export function getSessionSummary(db: Database, id: number): any {
  return db.query('SELECT * FROM session_summaries WHERE id = ?').get(id) as any;
}
```

---

## Step 4: Run Tests

```bash
bun test tests/sqlite/observation-agent-metadata.test.ts
```

---

## Step 5: Update Callers (If Needed)

Check for places that call `insertObservation()` or `insertSessionSummary()` and consider whether they should pass agent metadata. For hooks, this might come from context:

```typescript
// Example in post-tool-use hook
insertObservation(db, {
  ...observationData,
  agent: context.agentId ?? 'legacy',
  department: context.department ?? 'default',
  visibility: context.defaultVisibility ?? 'project'
});
```

---

## Step 6: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-2.5.spec.md`.

---

## Step 7: Commit

```bash
git add src/services/sqlite/observations.ts \
        src/services/sqlite/session-summaries.ts \
        tests/sqlite/observation-agent-metadata.test.ts \
        docs/plans/agents/specs/task-2.5.spec.md
git commit -m "feat: add agent metadata to observation and session summary insertion

- insertObservation() accepts agent, department, visibility
- insertSessionSummary() accepts same fields
- Defaults: agent='legacy', department='default', visibility='project'
- Validates visibility against allowed values

Part of #15"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-2.6-visibility-enforcement.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 2.5 -->
## Context from Previous Agent

Task 2.5 is complete. Observations and session summaries now store agent metadata:

```typescript
insertObservation(db, {
  project: 'github.com/user/repo',
  session_id: 'session-123',
  type: 'discovery',
  title: 'Found bug',
  narrative: 'Details...',
  concepts: ['debugging'],
  files: ['src/index.ts'],
  tools: ['Read'],
  // New fields:
  agent: 'seb@laptop',
  department: 'engineering',
  visibility: 'department'  // private | department | project | public
});
```

Defaults if not provided:
- agent: 'legacy'
- department: 'default'
- visibility: 'project'

Your task is to enforce visibility rules when searching/reading observations.
Use `AgentService.canAccessObservation()` to filter results.

Tests passing: `bun test tests/sqlite/observation-agent-metadata.test.ts`
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All tests pass
- [ ] Backwards compatible (defaults work)
- [ ] Invalid visibility rejected
- [ ] Code committed
- [ ] Handoff comment added to task-2.6
