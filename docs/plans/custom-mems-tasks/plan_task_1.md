# Task 1: Worker HTTP Endpoint — POST /api/save

**Parent plan**: `docs/plans/feat-custom-mems.md`
**Branch**: `feat/plan_task_1`  (branch from `feat/custom-mems`)
**Dependency**: None — this is the first task
**Blocks**: Task 2 (MCP tool definition depends on this endpoint existing)

---

## Parallelism Note

**Task 1 and Task 2 are SEQUENTIAL.** Task 2 (MCP tool) calls this endpoint via HTTP, so this must be completed and merged first.

---

## Context

### Previous Task
None — this is the first task.

### Next Task
**Task 2** (`plan_task_2.md`) — adds the `save` tool definition to the MCP server at `src/servers/mcp-server.ts`. That tool calls `callWorkerAPIPost('/api/save', args)` to reach the endpoint built in this task. The next agent needs:
- The exact endpoint path: `POST /api/save`
- The request body shape
- The response body shape
- Any error codes/formats

---

## Spec

### Endpoint
```
POST /api/save
Content-Type: application/json
```

### Request Body
```typescript
{
  title: string;              // REQUIRED
  text: string;               // REQUIRED
  type?: string;              // Default: 'discovery'. Valid: decision, bugfix, feature, refactor, discovery, change
  project?: string;           // Default: 'manual'
  memory_session_id?: string; // For grouping related observations. Auto-generated if omitted.
  facts?: string[];           // Default: []
  concepts?: string[];        // Default: []
  files_read?: string[];      // Default: []
  files_modified?: string[];  // Default: []
  agent?: string;             // Default: 'legacy' (set by storeObservation)
  department?: string;        // Default: 'default' (set by storeObservation)
  visibility?: string;        // Default: 'project'. Valid: private, department, project, public
}
```

### Response (200)
```json
{
  "success": true,
  "id": 12345,
  "memory_session_id": "mcp-1707123456789-a1b2c3",
  "created_at_epoch": 1707123456789
}
```

### Error Responses (400)
```json
{ "error": "title is required and must be a string" }
{ "error": "text is required and must be a string" }
```

Invalid visibility values will return a 500 (thrown by `storeObservation`'s `validateVisibility()`).

### Implementation Location

**File**: `src/services/worker/http/routes/DataRoutes.ts`

**Imports to add** (top of file):
```typescript
import { storeObservation } from '../../../sqlite/observations/store.js';
import type { ObservationInput } from '../../../sqlite/observations/types.js';
```

**Route registration** — add in `setupRoutes()` method after `app.post('/api/import', ...)` (line 61):
```typescript
app.post('/api/save', this.handleSaveObservation.bind(this));
```

**Handler** — add as new method after `handleImport` (after line 371):
```typescript
private handleSaveObservation = this.wrapHandler((req: Request, res: Response): void => {
  // See plan for full implementation
});
```

### Key Implementation Details

1. **Uses existing `storeObservation()`** from `src/services/sqlite/observations/store.ts` — no new DB code needed
2. **Access DB via** `this.dbManager.getSessionStore().db` — follows existing DataRoutes pattern
3. **Validation**: Only `title` and `text` are required. Everything else has defaults.
4. **memory_session_id**: If not provided, generate `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
5. **Maps `text` field to `narrative`** in ObservationInput (user-facing name vs internal name)
6. **Array fields**: Use `Array.isArray(x) ? x : []` to safely handle non-array inputs

### Existing Patterns to Follow

- `handleGetObservationsByIds` (line 115) — POST handler with body validation
- `handleImport` (line 303) — POST handler with DB writes
- `this.wrapHandler()` — wraps all handlers with error catching
- `this.badRequest(res, message)` — returns 400 errors

### Files Agent Must Read Before Coding

1. `src/services/worker/http/routes/DataRoutes.ts` — target file, understand structure
2. `src/services/sqlite/observations/store.ts` — `storeObservation()` signature and behavior
3. `src/services/sqlite/observations/types.ts` — `ObservationInput` interface
4. `src/services/worker/http/BaseRouteHandler.ts` — `wrapHandler()`, `badRequest()`, `notFound()`
5. `src/constants/observation-metadata.ts` — valid observation types

---

## Tests

**Test file**: `tests/api-save-endpoint.test.ts` (or colocated with existing route tests)

Agent must check for existing test patterns first:
```bash
find . -name "*.test.ts" -path "*/worker/*" -o -name "*.test.ts" -path "*/routes/*" | head -20
```

### Test Cases

#### 1. Success — minimal required fields
```typescript
// POST /api/save with { title: "Test", text: "Content" }
// Expect: 200, { success: true, id: number, memory_session_id: string, created_at_epoch: number }
// Expect: type defaults to 'discovery'
// Expect: memory_session_id starts with 'mcp-'
```

#### 2. Success — all fields provided
```typescript
// POST /api/save with all fields including memory_session_id, agent, department, visibility
// Expect: 200, memory_session_id matches the provided value
// Expect: observation stored with all provided values
```

#### 3. Error — missing title
```typescript
// POST /api/save with { text: "Content" }
// Expect: 400, { error: "title is required and must be a string" }
```

#### 4. Error — missing text
```typescript
// POST /api/save with { title: "Test" }
// Expect: 400, { error: "text is required and must be a string" }
```

#### 5. Error — empty body
```typescript
// POST /api/save with {}
// Expect: 400
```

#### 6. Validation — array fields handle non-array gracefully
```typescript
// POST /api/save with { title: "Test", text: "Content", facts: "not-an-array" }
// Expect: 200, facts stored as []
```

#### 7. Validation — memory_session_id grouping
```typescript
// POST /api/save twice with same memory_session_id
// Expect: Both observations share the same memory_session_id
// Verify via GET /api/observations or direct DB query
```

#### 8. Validation — invalid visibility rejected
```typescript
// POST /api/save with { title: "T", text: "C", visibility: "invalid" }
// Expect: 500 (storeObservation throws on invalid visibility)
```

---

## Completion Criteria

- [ ] All 8 test cases pass
- [ ] Endpoint responds at POST /api/save
- [ ] Observation appears in database after save
- [ ] Build succeeds: `npm run build`
- [ ] Existing tests still pass

## Commit Message Template

```
feat: add POST /api/save endpoint for manual observations

Implements worker HTTP endpoint for saving observations directly,
without going through the SDK agent processing pipeline.

Unlocks: Task 2 (MCP tool definition) can now be implemented.
The MCP tool at src/servers/mcp-server.ts will call POST /api/save
via callWorkerAPIPost().

API: POST /api/save
Required: title (string), text (string)
Optional: type, project, memory_session_id, facts, concepts,
  files_read, files_modified, agent, department, visibility
Response: { success, id, memory_session_id, created_at_epoch }

Files changed:
- src/services/worker/http/routes/DataRoutes.ts (endpoint + handler)
- tests/api-save-endpoint.test.ts (8 test cases)
```
