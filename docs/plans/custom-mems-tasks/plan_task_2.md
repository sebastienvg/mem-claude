# Task 2: MCP Tool Definition — `save` tool

**Parent plan**: `docs/plans/feat-custom-mems.md`
**Branch**: `feat/plan_task_2`  (branch from `feat/custom-mems`)
**Dependency**: **BLOCKED BY Task 1** — the POST /api/save endpoint must exist first
**Blocks**: None — this is the final task

---

## Parallelism Note

**SEQUENTIAL — this task depends on Task 1.** The `save` MCP tool calls `callWorkerAPIPost('/api/save', args)`. Task 1 must be merged into `feat/custom-mems` before starting this task.

---

## Context

### Previous Task
**Task 1** (`plan_task_1.md`) — adds `POST /api/save` endpoint in `DataRoutes.ts`. That endpoint:
- Accepts: `{ title, text, type?, project?, memory_session_id?, facts?, concepts?, files_read?, files_modified?, agent?, department?, visibility? }`
- Returns: `{ success: true, id: number, memory_session_id: string, created_at_epoch: number }`
- Errors: 400 for missing title/text, 500 for invalid visibility
- Agent for Task 1 will have documented the exact API contract in their PR

### Next Task
None — this is the final task. After this, the feature is complete and ready for the final PR to `main`.

---

## Spec

### MCP Tool Definition

Add to the `tools` array in `src/servers/mcp-server.ts`, after the `get_observations` tool (line 234).

```typescript
{
  name: 'save',
  description: 'Save observation to memory. Params: title (required), text (required), type, project, memory_session_id, facts[], concepts[], agent, department, visibility',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Observation title' },
      text: { type: 'string', description: 'Observation content/narrative' },
      type: {
        type: 'string',
        enum: ['decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change'],
        description: 'Observation type (default: discovery)'
      },
      project: { type: 'string', description: 'Project name (default: manual)' },
      memory_session_id: { type: 'string', description: 'Session ID for grouping related saves' },
      facts: { type: 'array', items: { type: 'string' }, description: 'Key facts' },
      concepts: { type: 'array', items: { type: 'string' }, description: 'Related concepts' },
      agent: { type: 'string', description: 'Agent identifier (default: legacy)' },
      department: { type: 'string', description: 'Department name (default: default)' },
      visibility: {
        type: 'string',
        enum: ['private', 'department', 'project', 'public'],
        description: 'Visibility level (default: project)'
      }
    },
    required: ['title', 'text'],
    additionalProperties: true
  },
  handler: async (args: any) => {
    return await callWorkerAPIPost('/api/save', args);
  }
}
```

### Key Implementation Details

1. **Uses `callWorkerAPIPost()`** (line 93) — same pattern as `get_observations` tool
2. **Does NOT add to `TOOL_ENDPOINT_MAP`** — that map is only for GET endpoints using `callWorkerAPI()`
3. **`additionalProperties: true`** — allows forward-compatible param additions
4. **`required: ['title', 'text']`** — MCP validates before calling handler
5. **Response wrapping**: `callWorkerAPIPost()` auto-wraps the JSON response in `{ content: [{ type: 'text', text: JSON.stringify(data) }] }` format

### MCP Server Architecture (for context)

The MCP server is a thin HTTP wrapper:
- `callWorkerAPI(endpoint, params)` — for GET with query params (search, timeline)
- `callWorkerAPIPost(endpoint, body)` — for POST with JSON body (get_observations, **save**)
- Tools are listed via `ListToolsRequestSchema` handler (line 251)
- Tools are invoked via `CallToolRequestSchema` handler (line 262)
- Error handling wraps all tool calls (line 269-280)

### Existing Tool Patterns to Follow

| Tool | Method | Handler Pattern |
|------|--------|-----------------|
| `search` | GET | `callWorkerAPI(TOOL_ENDPOINT_MAP['search'], args)` |
| `timeline` | GET | `callWorkerAPI(TOOL_ENDPOINT_MAP['timeline'], args)` |
| `get_observations` | POST | `callWorkerAPIPost('/api/observations/batch', args)` |
| **`save`** | **POST** | **`callWorkerAPIPost('/api/save', args)`** |

### Files Agent Must Read Before Coding

1. `src/servers/mcp-server.ts` — target file, understand all tool definitions
2. `docs/plans/custom-mems-tasks/plan_task_1.md` — Task 1 spec (the endpoint this tool calls)
3. Task 1's PR description — for any implementation details or deviations from spec

---

## Tests

**Test file**: `tests/mcp-save-tool.test.ts` (or colocated with existing MCP tests)

Agent must check for existing MCP test patterns first:
```bash
find . -name "*.test.ts" -path "*mcp*" -o -name "*.test.ts" -path "*server*" | head -20
```

### Test Cases

#### 1. Tool is registered
```typescript
// Verify 'save' appears in the tools list
// Call ListToolsRequestSchema handler
// Expect: tools array includes { name: 'save', ... }
```

#### 2. Tool schema is correct
```typescript
// Verify inputSchema has required: ['title', 'text']
// Verify inputSchema.properties includes all 10 properties
// Verify type enum matches: ['decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change']
// Verify visibility enum matches: ['private', 'department', 'project', 'public']
```

#### 3. Tool handler calls worker API
```typescript
// Mock fetch to intercept callWorkerAPIPost
// Call save tool with { title: "Test", text: "Content" }
// Verify: POST request sent to ${WORKER_BASE_URL}/api/save
// Verify: Request body matches args
```

#### 4. Tool handler wraps response in MCP format
```typescript
// Mock fetch to return { success: true, id: 1, memory_session_id: "mcp-...", created_at_epoch: 123 }
// Call save tool
// Expect: { content: [{ type: 'text', text: '{"success":true,...}' }] }
```

#### 5. Tool handler returns error on worker failure
```typescript
// Mock fetch to return 400 status
// Call save tool
// Expect: { content: [{ type: 'text', text: 'Error calling Worker API: ...' }], isError: true }
```

#### 6. Tool handler handles network error
```typescript
// Mock fetch to throw network error
// Call save tool
// Expect: { content: [{ type: 'text', text: 'Error calling Worker API: ...' }], isError: true }
```

---

## Completion Criteria

- [ ] All 6 test cases pass
- [ ] `save` tool appears in MCP tool list
- [ ] Tool calls POST /api/save endpoint correctly
- [ ] Build succeeds: `npm run build`
- [ ] Existing tests still pass
- [ ] End-to-end: MCP save -> search returns the saved observation

## Commit Message Template

```
feat: add save tool to MCP server

Adds a 'save' tool to the MCP server that allows agents to persist
observations directly via the MCP protocol.

Depends on: Task 1 (POST /api/save endpoint in DataRoutes.ts)

The save tool:
- Calls POST /api/save via callWorkerAPIPost()
- Follows same pattern as get_observations tool
- Schema exposes all fields: title, text, type, project,
  memory_session_id, facts, concepts, agent, department, visibility
- MCP validates required fields (title, text) before handler

Closes #24

Files changed:
- src/servers/mcp-server.ts (save tool definition)
- tests/mcp-save-tool.test.ts (6 test cases)
```
