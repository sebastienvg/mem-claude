# Task 2.5 Specification: Observation Agent Metadata

## Requirements

### storeObservation()
- [x] Accepts optional agent, department, visibility parameters via ObservationInput
- [x] Defaults: agent='legacy', department='default', visibility='project'
- [x] Validates visibility is one of: private, department, project, public
- [x] Stores metadata in observation record

### storeSummary()
- [x] Accepts optional agent, department, visibility parameters via SummaryInput
- [x] Same defaults as observations
- [x] Stores metadata in session summary record

### Visibility Levels
- [x] `private`: Only the creating agent can see
- [x] `department`: All agents in same department can see
- [x] `project`: All agents with project access can see
- [x] `public`: All agents can see

### Backwards Compatibility
- [x] Existing code without metadata works (uses defaults)
- [x] Database columns have defaults ('legacy', 'default', 'project')
- [x] No breaking changes to existing function signatures

## Type Definitions

### ObservationInput (extended)
```typescript
export interface ObservationInput {
  type: string;
  title: string | null;
  subtitle: string | null;
  facts: string[];
  narrative: string | null;
  concepts: string[];
  files_read: string[];
  files_modified: string[];
  // New optional fields for multi-agent
  agent?: string;
  department?: string;
  visibility?: 'private' | 'department' | 'project' | 'public';
}
```

### SummaryInput (extended)
```typescript
export interface SummaryInput {
  request: string;
  investigated: string;
  learned: string;
  completed: string;
  next_steps: string;
  notes: string | null;
  // New optional fields for multi-agent
  agent?: string;
  department?: string;
  visibility?: 'private' | 'department' | 'project' | 'public';
}
```

### Visibility Type
```typescript
export type VisibilityLevel = 'private' | 'department' | 'project' | 'public';
export const VALID_VISIBILITIES: VisibilityLevel[] = ['private', 'department', 'project', 'public'];
```

## Test Cases

### observation-agent-metadata.test.ts
- [x] Inserts observation with all metadata fields
- [x] Inserts observation with defaults when metadata not provided
- [x] Rejects invalid visibility value
- [x] Accepts all valid visibility values (private, department, project, public)
- [x] Session summary with metadata
- [x] Session summary with defaults
- [x] Session summary rejects invalid visibility
- [x] Allows partial metadata (only agent)
- [x] Allows partial metadata (only visibility)
- [x] Allows partial metadata (only department)

## Validation

### Visibility Validation
```typescript
const VALID_VISIBILITIES = ['private', 'department', 'project', 'public'];

function validateVisibility(visibility?: string): void {
  if (visibility && !VALID_VISIBILITIES.includes(visibility)) {
    throw new Error(`Invalid visibility: ${visibility}. Must be one of: ${VALID_VISIBILITIES.join(', ')}`);
  }
}
```

## Database Schema (already exists from migration 021)

### observations table extensions
- `agent TEXT DEFAULT 'legacy'`
- `department TEXT DEFAULT 'default'`
- `visibility TEXT DEFAULT 'project'` with CHECK constraint

### session_summaries table extensions
- `agent TEXT DEFAULT 'legacy'`
- `department TEXT DEFAULT 'default'`
- `visibility TEXT DEFAULT 'project'` with CHECK constraint

## Files Modified

| File | Change |
|------|--------|
| `src/services/sqlite/observations/types.ts` | Added VisibilityLevel type, VALID_VISIBILITIES constant, and optional agent metadata fields to ObservationInput |
| `src/services/sqlite/observations/store.ts` | Added visibility validation and agent metadata storage |
| `src/services/sqlite/summaries/types.ts` | Added optional agent metadata fields to SummaryInput |
| `src/services/sqlite/summaries/store.ts` | Added visibility validation and agent metadata storage |
| `tests/sqlite/observation-agent-metadata.test.ts` | Created comprehensive test suite (11 tests) |

## Test Results

```
bun test tests/sqlite/observation-agent-metadata.test.ts
 11 pass
 0 fail
 35 expect() calls
Ran 11 tests across 1 file.
```

All existing tests continue to pass (106 SQLite tests total).
