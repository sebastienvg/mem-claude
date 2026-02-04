# Claude-Mem Containerization - Step 5: Hook Integration

**Phase**: 5 of 6
**Complexity**: Low
**Dependencies**: Step 4

---

## Context Files to Read

Before starting, read these files to understand the context:
1. `/Users/seb/AI/claude-mem/plugin/hooks/hooks.json` - Hook configuration
2. `/Users/seb/AI/claude-mem/src/utils/` - Utility functions including HTTP clients
3. `/Users/seb/AI/claude-mem/src/hooks/` - Hook implementations
4. `containerization_step-5.spec` - Specification for this step

---

## Task Description

Ensure hooks can communicate with a containerized worker service by supporting configurable worker URLs. Hooks run on the host and need to reach the worker whether it's running natively or in a container.

---

## Implementation Steps

1. Identify where hooks make HTTP requests to the worker
2. Add `CLAUDE_MEM_WORKER_URL` environment variable support
3. Default behavior:
   - If `CLAUDE_MEM_WORKER_URL` set → use that URL
   - Otherwise → construct from `CLAUDE_MEM_WORKER_HOST` + `CLAUDE_MEM_WORKER_PORT`
   - Final fallback → `http://localhost:37777`
4. Update hook documentation
5. Test hooks work with containerized worker

---

## Testing

```bash
# Start containerized worker
docker compose up -d

# Test hooks can reach container (default port forwarding)
npm run hook:test:session-start

# Test with explicit URL
CLAUDE_MEM_WORKER_URL=http://localhost:37777 npm run hook:test:post-tool-use

# Test hooks still work with native worker
docker compose down
npm run worker:start
npm run hook:test:session-start
```

---

## Success Criteria

- [ ] Hooks work with containerized worker (port forwarded)
- [ ] `CLAUDE_MEM_WORKER_URL` overrides default construction
- [ ] Backward compatible with native worker
- [ ] Error messages helpful when worker unreachable
- [ ] Documentation updated

---

## When Complete

1. Commit with message: `feat(hooks): support configurable worker URL for container mode`
2. Notify: "Hooks now support containerized worker via port forwarding or explicit URL. Proceed to Step 6 for distribution setup."

---

## Next Step

After completion, proceed with `containerization_step-6.md`
