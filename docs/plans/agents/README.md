# Agent Task Files for Repo Identity & Multi-Agent Implementation

This directory contains detailed task files for implementing Issues #14 and #15.

## How to Use

Each task file is designed for an individual agent to:
1. Read the task specification
2. Create a `.spec.md` file in the `specs/` directory
3. Write tests that initially fail
4. Implement the code to make tests pass
5. Commit with meaningful message
6. Add handoff comment to the next task file

## Task Index

### Phase 1: Git Repository Identification (Issue #14)

| Task | File | Description |
|------|------|-------------|
| 1.1 | `task-1.1-git-remote-utility.md` | Git remote URL normalization |
| 1.2 | `task-1.2-update-project-name.md` | Update getProjectName() |
| 1.3 | `task-1.3-project-aliases-migration.md` | Database migration for aliases |
| 1.4 | `task-1.4-project-alias-service.md` | Alias resolution service |
| 1.5 | `task-1.5-session-alias-registration.md` | Auto-register on session start |
| 1.6 | `task-1.6-query-alias-support.md` | Include aliases in queries |
| 1.7 | `task-1.7-migration-cli.md` | CLI for alias management |

### Phase 2: Multi-Agent Architecture (Issue #15)

| Task | File | Description |
|------|------|-------------|
| 2.1 | `task-2.1-agents-table-migration.md` | Agents table with O(1) lookup |
| 2.2 | `task-2.2-agent-service.md` | AgentService with brute-force protection |
| 2.3 | `task-2.3-auth-middleware.md` | Express auth middleware |
| 2.4 | `task-2.4-agent-api-endpoints.md` | Agent REST API |
| 2.5 | `task-2.5-observation-agent-metadata.md` | Agent metadata on observations |
| 2.6 | `task-2.6-visibility-enforcement.md` | Enforce visibility in queries |

### Phase 3: Integration & Testing

| Task | File | Description |
|------|------|-------------|
| 3.1 | `task-3.1-e2e-tests.md` | End-to-end integration tests |
| 3.2 | `task-3.2-settings-integration.md` | New feature settings |
| 3.3 | `task-3.3-documentation.md` | Update all documentation |
| 3.4 | `task-3.4-final-review.md` | Final review and release prep |

### Phase 4: Polish & Maintenance (Optional)

| Task | File | Description |
|------|------|-------------|
| 4.1 | `task-4.1-prefix-collisions.md` | Handle rare key prefix collisions |
| 4.2 | `task-4.2-maintenance-cli.md` | Maintenance CLI commands |
| 4.3 | `task-4.3-metrics-endpoint.md` | /api/metrics for monitoring |
| 4.4 | `task-4.4-agent-self-info.md` | Enhanced /api/agents/me |

## Execution Order

Tasks must be executed in order within each phase. Phases 1 and 2 are independent and could theoretically run in parallel, but Phase 3 depends on both.

```
Phase 1: 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7
                                                    ↘
Phase 2: 2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6           → Phase 3 → Phase 4
```

## Handoff Protocol

Each task ends with a "Handoff" section containing a comment to add to the next task file. This provides context continuity between agents.

Example:
```markdown
<!-- HANDOFF FROM TASK 1.1 -->
## Context from Previous Agent

Task 1.1 is complete. The following utilities are now available:
- `src/utils/git-available.ts`: `isGitAvailable()`, `resetGitAvailableCache()`
- `src/utils/git-remote.ts`: `normalizeGitUrl()`, `getGitRemoteIdentifier()`

Tests passing: `bun test tests/utils/git-*.test.ts`
<!-- END HANDOFF -->
```

## Specification Files

Each agent should create a specification file in `specs/` before implementation:
- `specs/task-1.1.spec.md`
- `specs/task-1.2.spec.md`
- etc.

The spec file should contain:
- Detailed requirements with checkboxes
- Test cases to implement
- Edge cases to consider

## Total Tasks: 21

- Core tasks: 17 (Phases 1-3)
- Optional polish: 4 (Phase 4)
