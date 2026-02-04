# Task 3.1 Specification: E2E Integration Tests

## Project Identity E2E Tests

### Git Remote Detection
- [x] Detects git remote for real repository
- [x] Falls back to basename for non-git directory
- [x] Falls back to basename for repo without remote

### Alias Registration
- [x] Registers alias on session start
- [x] Alias persists across sessions
- [x] Old observations accessible via new project ID

### Query with Aliases
- [x] Search returns data from both old and new project IDs
- [x] Context includes aliased observations

## Multi-Agent E2E Tests

### Agent Lifecycle
- [x] Register -> Verify -> Use -> Rotate -> Revoke
- [x] Key expiration after 90 days (mocked)
- [x] Brute-force lockout after 5 failures

### Visibility Workflow
- [x] Agent creates private observation
- [x] Same agent can read it
- [x] Different agent cannot read it
- [x] Same-department agent can read department observation

### API Integration
- [x] Full register/verify flow via HTTP
- [x] Protected endpoints require valid token
- [x] Rate limiting works (tested manually)

## Combined Tests

### Cross-Feature Integration
- [x] Agent creates observation with git remote project ID
- [x] Observation accessible via alias
- [x] Visibility enforced correctly

## Test Files Created

| File | Description |
|------|-------------|
| `tests/e2e/project-identity.e2e.test.ts` | Git remote detection, alias registration, cross-ID queries |
| `tests/e2e/multi-agent.e2e.test.ts` | Agent lifecycle, visibility enforcement, API integration |

## Test Coverage Summary

- **Project Identity Tests**: 9 tests
  - Git remote detection (3)
  - Alias registration (3)
  - Cross-project queries (2)
  - Full integration flow (1)

- **Multi-Agent Tests**: 13 tests
  - Agent lifecycle (3)
  - Visibility enforcement (5)
  - Combined project identity + multi-agent (2)
  - API integration patterns (3)

**Total: 22 E2E tests (all passing)**
