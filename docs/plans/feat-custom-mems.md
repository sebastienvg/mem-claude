# Plan: Add save/create_observation Tool to MCP Server

**Issue**: https://github.com/sebastienvg/mem-claude/issues/24
**Branch**: `feat/custom-mems`

## Problem

The MCP server only provides read-only tools (`__IMPORTANT`, `search`, `timeline`, `get_observations`). Agents using MCP cannot manually save memories—they must use direct HTTP or database access.

## Solution

Add a `save` tool to the MCP server that allows agents to persist observations directly.

## Architecture

```
MCP Client (Claude)     MCP Server                    Worker Service
┌─────────────────┐     ┌─────────────────┐          ┌─────────────────┐
│ save(title,     │────▶│ save tool       │──POST───▶│ /api/save       │
│   text, type)   │     │ handler         │          │ endpoint        │
└─────────────────┘     └─────────────────┘          └─────────────────┘
                                                              │
                                                              ▼
                                                     storeObservation()
                                                     (from observations/store.ts)
```

The MCP server is a thin HTTP wrapper. All business logic lives in the worker.

## Files to Modify

### 1. `src/services/worker/http/routes/DataRoutes.ts`

**Import** (add at top with other imports):
```typescript
import { storeObservation } from '../../../sqlite/observations/store.js';
import type { ObservationInput } from '../../../sqlite/observations/types.js';
```

**Route registration** (add in `setupRoutes()` after line 61):
```typescript
// Manual observation save endpoint
app.post('/api/save', this.handleSaveObservation.bind(this));
```

**Handler** (add after `handleImport` around line 371):
```typescript
/**
 * Save a manual observation
 * POST /api/save
 * Body: { title, text, type?, project?, facts?, concepts?, files_read?, files_modified?, agent?, department?, visibility? }
 */
private handleSaveObservation = this.wrapHandler((req: Request, res: Response): void => {
  const { title, text, type, project, facts, concepts, files_read, files_modified, agent, department, visibility } = req.body;

  // Validate required fields
  if (!title || typeof title !== 'string') {
    this.badRequest(res, 'title is required and must be a string');
    return;
  }
  if (!text || typeof text !== 'string') {
    this.badRequest(res, 'text is required and must be a string');
    return;
  }

  // Map to ObservationInput
  const observation: ObservationInput = {
    type: type || 'note',
    title: title,
    subtitle: null,
    facts: Array.isArray(facts) ? facts : [],
    narrative: text,
    concepts: Array.isArray(concepts) ? concepts : [],
    files_read: Array.isArray(files_read) ? files_read : [],
    files_modified: Array.isArray(files_modified) ? files_modified : [],
    agent: agent,
    department: department,
    visibility: visibility
  };

  // Generate unique memory session ID for manual observations
  const memorySessionId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projectName = project || 'manual';

  const result = storeObservation(
    this.dbManager.getSessionStore().db,
    memorySessionId,
    projectName,
    observation
  );

  res.json({
    success: true,
    id: result.id,
    created_at_epoch: result.createdAtEpoch
  });
});
```

### 2. `src/servers/mcp-server.ts`

**Add tool definition** (after `get_observations` tool, before the closing bracket of `tools` array, around line 234):

```typescript
,
{
  name: 'save',
  description: 'Save observation to memory. Params: title (required), text (required), type, project, facts[], concepts[]',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Observation title' },
      text: { type: 'string', description: 'Observation content/narrative' },
      type: {
        type: 'string',
        enum: ['decision', 'bugfix', 'feature', 'refactor', 'discovery', 'note'],
        description: 'Observation type'
      },
      project: { type: 'string', description: 'Project name (default: manual)' },
      facts: { type: 'array', items: { type: 'string' }, description: 'Key facts' },
      concepts: { type: 'array', items: { type: 'string' }, description: 'Related concepts' }
    },
    required: ['title', 'text'],
    additionalProperties: true
  },
  handler: async (args: any) => {
    return await callWorkerAPIPost('/api/save', args);
  }
}
```

Note: The `TOOL_ENDPOINT_MAP` is only used for GET endpoints (`search`, `timeline`). The `save` tool calls `callWorkerAPIPost()` directly with the endpoint path, following the same pattern as `get_observations`.

## API Design

### Request
```json
POST /api/save
{
  "title": "Discovered rate limiting in API",
  "text": "The external API has a 100 req/min limit. Added exponential backoff.",
  "type": "discovery",
  "project": "my-project",
  "facts": ["API limit is 100 req/min", "Backoff implemented"],
  "concepts": ["rate-limiting", "exponential-backoff"]
}
```

### Response
```json
{
  "success": true,
  "id": 12345,
  "created_at_epoch": 1707123456789
}
```

### Validation
- `title`: Required, string
- `text`: Required, string
- `type`: Optional, defaults to "note", must be one of: decision, bugfix, feature, refactor, discovery, note
- `project`: Optional, defaults to "manual"
- `facts`: Optional, array of strings
- `concepts`: Optional, array of strings
- `files_read`: Optional, array of strings
- `files_modified`: Optional, array of strings
- Multi-agent fields (agent, department, visibility): Optional, passed through

## Verification

1. **Build the project**:
   ```bash
   npm run build
   ```

2. **Start worker** (if not using Docker):
   ```bash
   npm run worker:restart
   ```

3. **Test HTTP endpoint directly**:
   ```bash
   # Basic save
   curl -X POST http://localhost:37777/api/save \
     -H "Content-Type: application/json" \
     -d '{"title":"Test observation","text":"This is a test","type":"note"}'

   # Expected: {"success":true,"id":123,"created_at_epoch":1707123456789}

   # Full save with all fields
   curl -X POST http://localhost:37777/api/save \
     -H "Content-Type: application/json" \
     -d '{
       "title":"API rate limit discovered",
       "text":"External API limits requests to 100/min. Implemented exponential backoff.",
       "type":"discovery",
       "project":"my-project",
       "facts":["API limit is 100 req/min","Backoff delay starts at 1s"],
       "concepts":["rate-limiting","exponential-backoff"]
     }'
   ```

4. **Verify observation appears in search**:
   ```bash
   curl "http://localhost:37777/api/search?query=rate+limit"
   ```

5. **Verify in viewer UI**: Check http://localhost:37777 for new observation

6. **Test MCP tool** (restart Claude Code after build to pick up new tool):
   - Use the `save` tool: `save(title="Test", text="Content", type="note")`
   - Verify with `search(query="Test")`

## Summary

- Add imports to DataRoutes.ts (2 lines)
- Add route registration (1 line)
- Add handler method (~45 lines)
- Add MCP tool definition (~25 lines)
- **Total: ~75 lines of code**
