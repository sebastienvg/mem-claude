# Task 2.6 Specification: Visibility Enforcement

## Requirements

### Query Functions

#### searchObservations() - SessionSearch
- [x] Accepts optional agentId parameter
- [x] Accepts optional agentService parameter
- [x] If agentId provided with agentService, filters results by visibility
- [x] If no agentId, returns only 'project' and 'public' (legacy behavior)
- [x] Uses SQL-level filtering for performance

#### getObservationsByIds() - SessionStore
- [x] Accepts optional visibility filtering options
- [x] Agent can always see their own observations (private)
- [x] Same-department agents can see department visibility
- [x] All agents can see project/public visibility

#### findByConcept(), findByType(), findByFile() - SessionSearch
- [x] Same visibility filtering applied via common buildFilterClause()

### Visibility Rules Recap
- `public`: Everyone can see
- `project`: Currently = public (no project ACLs yet)
- `department`: Same department only
- `private`: Owner only

### Performance Considerations
- [x] Filter at SQL level when possible
- [x] Post-filter only when necessary (department check)
- [x] Limit results before expensive filtering

### Notes
```
IMPORTANT: visibility = 'project' currently means "visible to everyone".
If project-level ACLs are added in future, this filter must be updated
to check project membership.
```

## Test Cases

### visibility-enforcement.test.ts
- [x] Agent sees own private observations
- [x] Agent cannot see other's private observations
- [x] Agent sees department observations (same dept)
- [x] Agent cannot see department observations (different dept)
- [x] Agent sees project/public observations
- [x] Legacy mode (no agent) sees project/public only
- [x] Unknown agent sees project/public only
