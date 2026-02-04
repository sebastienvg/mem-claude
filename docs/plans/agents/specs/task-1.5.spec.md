# Task 1.5 Specification: Session Alias Registration

## Requirements

### Session Start Hook Enhancement
- [x] Detect current project name using getProjectName()
- [x] If project name is a git remote ID, also compute the basename fallback
- [x] If basename differs from git remote ID, register alias
- [x] Handle cases where project has no git remote (no alias needed)
- [x] Registration should be non-blocking (don't fail session if alias registration fails)

### Logic Flow
```
1. Get cwd from request (or environment)
2. Get project name (git remote or basename)
3. If project name looks like git remote (contains '/'):
   a. Compute basename from cwd
   b. If basename != project name:
      - Register alias(basename -> project name)
4. Continue with normal session init
```

### Integration Point
The alias registration is integrated into the worker's `handleSessionInitByClaudeId`
endpoint (`POST /api/sessions/init`) via `registerSessionAlias()` function.

This is the server-side entry point where:
- Database is available
- Project name is known
- CWD can be provided by the client

## Test Cases

### session-alias.test.ts
- [x] Registers alias when project has git remote (contains '/')
- [x] Does not register alias when basename equals project name
- [x] Handles missing cwd gracefully (returns without error)
- [x] Does not block session on registration failure
- [x] Logs alias registration at debug level

## Implementation Files

| File | Status |
|------|--------|
| `src/hooks/session-alias.ts` | Created |
| `tests/hooks/session-alias.test.ts` | Created |
| `src/cli/handlers/session-init.ts` | Modified (added cwd to request body) |
| `src/services/worker/http/routes/SessionRoutes.ts` | Modified (calls registerSessionAlias) |

## Notes

- The `registerSessionAlias()` function is a pure utility that can be tested in isolation
- It wraps the lower-level `registerProjectAlias()` from `project-aliases.ts`
- Non-blocking: Uses try-catch to ensure session init continues even on DB errors
- The function is idempotent - registering the same alias twice is a no-op
