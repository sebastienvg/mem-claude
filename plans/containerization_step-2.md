# Claude-Mem Containerization - Step 2: Worker Service Container

**Phase**: 2 of 6
**Complexity**: Medium
**Dependencies**: None

---

## Context Files to Read

Before starting, read these files to understand the context:
1. `/Users/seb/AI/claude-mem/src/services/worker-service.ts` - Main service entry point
2. `/Users/seb/AI/claude-mem/scripts/build.js` - Build process
3. `/Users/seb/AI/claude-mem/package.json` - Dependencies and scripts
4. `containerization_step-2.spec` - Specification for this step

---

## Task Description

Create a production-ready multi-stage Dockerfile for the worker service. The image should be minimal, secure, and include only the built artifacts needed to run the service.

---

## Implementation Steps

1. Create `.dockerignore` to exclude unnecessary files:
   - `node_modules/`, `.git/`, `tests/`, `docs/`, etc.
2. Create `Dockerfile` with multi-stage build:
   - **Stage 1 (builder)**: Full build environment with Bun/Node
   - **Stage 2 (runtime)**: Minimal Bun image with only built artifacts
3. Create `docker-entrypoint.sh` for:
   - Data directory initialization
   - Environment validation
   - Graceful shutdown handling
4. Add health check configuration
5. Document required environment variables
6. Test the build locally

---

## Testing

```bash
# Build the image
docker build -t claude-mem:local .

# Run with required env vars
docker run -d \
  --name claude-mem-test \
  -p 37777:37777 \
  -v ~/.claude-mem:/data \
  -e CLAUDE_MEM_DATA_DIR=/data \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  claude-mem:local

# Check health
curl http://localhost:37777/api/readiness

# Check logs
docker logs claude-mem-test

# Cleanup
docker stop claude-mem-test && docker rm claude-mem-test
```

---

## Success Criteria

- [ ] `Dockerfile` uses multi-stage build
- [ ] Final image size < 200MB
- [ ] Container starts and passes health check
- [ ] `/api/readiness` returns healthy status
- [ ] `/api/version` returns correct version
- [ ] Data persists in mounted volume
- [ ] Graceful shutdown on SIGTERM

---

## When Complete

1. Commit with message: `feat(docker): add production Dockerfile for worker service`
2. Notify: "Worker container image ready. Can run standalone with `docker run`. Proceed to Step 3 for Chroma HTTP integration."

---

## Next Step

After completion, proceed with `containerization_step-3.md`
