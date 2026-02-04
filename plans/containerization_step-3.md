# Claude-Mem Containerization - Step 3: Chroma HTTP Client Mode

**Phase**: 3 of 6
**Complexity**: Medium
**Dependencies**: Step 2

---

## Context Files to Read

Before starting, read these files to understand the context:
1. `/Users/seb/AI/claude-mem/src/services/sync/ChromaSync.ts` - Current Chroma MCP implementation
2. `/Users/seb/AI/claude-mem/src/shared/SettingsDefaultsManager.ts` - Settings management
3. `/Users/seb/AI/claude-mem/src/shared/types.ts` - Type definitions
4. `containerization_step-3.spec` - Specification for this step

---

## Task Description

Modify the Chroma integration to support HTTP client mode in addition to the existing MCP stdio mode. This enables connecting to an external Chroma server (containerized or cloud-hosted) instead of spawning a local process.

---

## Implementation Steps

1. Add new settings to `SettingsDefaultsManager.ts`:
   - `CLAUDE_MEM_CHROMA_MODE`: 'mcp' | 'http' | 'disabled'
   - `CLAUDE_MEM_CHROMA_URL`: URL for HTTP mode (default: `http://localhost:8000`)
2. Update types in `src/shared/types.ts` if needed
3. Modify `ChromaSync.ts`:
   - Add HTTP client using `chromadb` npm package
   - Keep existing MCP mode as fallback
   - Auto-detect mode based on settings
4. Add `chromadb` to package.json dependencies
5. Update build to include new dependency
6. Test both modes work correctly

---

## Testing

```bash
# Test MCP mode (existing behavior)
CLAUDE_MEM_CHROMA_MODE=mcp npm run worker:start
# Verify vector search works

# Start external Chroma server
docker run -d --name chroma -p 8000:8000 chromadb/chroma:latest

# Test HTTP mode
CLAUDE_MEM_CHROMA_MODE=http \
CLAUDE_MEM_CHROMA_URL=http://localhost:8000 \
npm run worker:start
# Verify vector search works

# Cleanup
docker stop chroma && docker rm chroma
```

---

## Success Criteria

- [ ] New settings added and documented
- [ ] HTTP client mode connects to external Chroma
- [ ] MCP mode still works (backward compatible)
- [ ] `disabled` mode skips Chroma entirely
- [ ] Auto-detection: HTTP if URL set, MCP otherwise
- [ ] Error handling for connection failures
- [ ] Tests pass for both modes

---

## When Complete

1. Commit with message: `feat(chroma): add HTTP client mode for containerized Chroma`
2. Notify: "Chroma now supports HTTP mode for external servers. Ready for Docker Compose integration in Step 4."

---

## Next Step

After completion, proceed with `containerization_step-4.md`
